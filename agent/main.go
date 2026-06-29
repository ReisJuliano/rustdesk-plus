package main

// Agente RustDesk Plus — roda como serviço Windows em cada PC gerenciado.
// Conecta ao plus-api via WebSocket e executa comandos remotos e scripts de automação.
//
// Build:
//   go build -ldflags "-X main.apiURL=http://SEU_IP:21114 -X main.deviceUUID=AUTO" -o rustdesk-agent.exe .

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// Injetados em build time
var (
	apiURL     = "http://localhost:21114"
	deviceUUID = "" // se vazio, derivado do hostname
	tenantID   = "" // UUID do tenant — obrigatório
)

// ── Config do dispositivo ────────────────────────────────────────────────────

func getDeviceUUID() string {
	if deviceUUID != "" {
		return deviceUUID
	}
	host, _ := os.Hostname()
	return "host-" + host
}

func getRustDeskID() string {
	cmd := exec.Command(`C:\Program Files\RustDesk\rustdesk.exe`, "--get-id")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// ── Protocolo — exec legado ──────────────────────────────────────────────────

type Command struct {
	JobID      string `json:"job_id"`
	Cmd        string `json:"cmd"`
	PowerShell bool   `json:"powershell"`
}

type Result struct {
	JobID      string `json:"job_id"`
	DeviceUUID string `json:"device_uuid"`
	Output     string `json:"output"`
	ExitCode   *int   `json:"exit_code,omitempty"`
	Done       bool   `json:"done"`
}

// ── Protocolo — scripts ──────────────────────────────────────────────────────

type ScriptNodeData struct {
	Label          string `json:"label"`
	Command        string `json:"command"`
	PowerShell     bool   `json:"powershell"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	URL            string `json:"url"`
	Destination    string `json:"destination"`
	Message        string `json:"message"`
}

type ScriptNode struct {
	ID   string         `json:"id"`
	Type string         `json:"type"`
	Data ScriptNodeData `json:"data"`
}

type ScriptEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type ScriptRunMsg struct {
	Type     string       `json:"type"`
	RunID    string       `json:"run_id"`
	ResultID string       `json:"result_id"`
	Nodes    []ScriptNode `json:"nodes"`
	Edges    []ScriptEdge `json:"edges"`
}

type ScriptProgressMsg struct {
	Type      string `json:"type"`
	RunID     string `json:"run_id"`
	ResultID  string `json:"result_id"`
	NodeID    string `json:"node_id"`
	NodeLabel string `json:"node_label"`
	Status    string `json:"status"`
	Output    string `json:"output"`
	ExitCode  *int   `json:"exit_code,omitempty"`
	AllDone   bool   `json:"all_done"`
}

// ── Execução de comando simples ──────────────────────────────────────────────

func runCommand(cmd Command, send func(Result)) {
	var c *exec.Cmd
	if cmd.PowerShell {
		c = exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", cmd.Cmd)
	} else {
		c = exec.Command("cmd", "/C", cmd.Cmd)
	}
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	stdout, _ := c.StdoutPipe()
	stderr, _ := c.StderrPipe()

	if err := c.Start(); err != nil {
		send(Result{
			JobID:      cmd.JobID,
			DeviceUUID: getDeviceUUID(),
			Output:     "ERRO ao iniciar: " + err.Error() + "\n",
			Done:       true,
		})
		return
	}

	var wg sync.WaitGroup
	stream := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			send(Result{
				JobID:      cmd.JobID,
				DeviceUUID: getDeviceUUID(),
				Output:     scanner.Text() + "\n",
				Done:       false,
			})
		}
	}

	wg.Add(2)
	go stream(stdout)
	go stream(stderr)
	wg.Wait()

	exitCode := 0
	if err := c.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
	}

	send(Result{
		JobID:      cmd.JobID,
		DeviceUUID: getDeviceUUID(),
		Output:     "",
		ExitCode:   &exitCode,
		Done:       true,
	})
}

// ── Execução de script (nós em sequência) ────────────────────────────────────

// topoSort retorna os IDs dos nós em ordem de execução (topological sort simples).
func topoSort(nodes []ScriptNode, edges []ScriptEdge) []string {
	inDegree := make(map[string]int)
	next := make(map[string][]string)

	for _, n := range nodes {
		inDegree[n.ID] = 0
	}
	for _, e := range edges {
		inDegree[e.Target]++
		next[e.Source] = append(next[e.Source], e.Target)
	}

	var queue []string
	for _, n := range nodes {
		if inDegree[n.ID] == 0 {
			queue = append(queue, n.ID)
		}
	}

	var order []string
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		order = append(order, cur)
		for _, tgt := range next[cur] {
			inDegree[tgt]--
			if inDegree[tgt] == 0 {
				queue = append(queue, tgt)
			}
		}
	}
	return order
}

// runShellNodeStreaming executa um comando e faz streaming de output linha a linha via onLine.
// Retorna exit_code e erro (apenas erros de sistema, não de exit_code != 0).
func runShellNodeStreaming(nodeCmd string, powershell bool, timeoutSec int, onLine func(string)) (int, error) {
	var c *exec.Cmd
	if powershell {
		c = exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", nodeCmd)
	} else {
		c = exec.Command("cmd", "/C", nodeCmd)
	}
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	stdout, _ := c.StdoutPipe()
	stderr, _ := c.StderrPipe()

	if err := c.Start(); err != nil {
		onLine("ERRO ao iniciar: " + err.Error())
		return -1, err
	}

	var wg sync.WaitGroup
	stream := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			onLine(scanner.Text())
		}
	}

	wg.Add(2)
	go stream(stdout)
	go stream(stderr)

	done := make(chan error, 1)
	go func() {
		wg.Wait()
		done <- c.Wait()
	}()

	timeout := time.Duration(timeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}

	select {
	case err := <-done:
		exitCode := 0
		if err != nil {
			if ee, ok := err.(*exec.ExitError); ok {
				exitCode = ee.ExitCode()
			}
		}
		return exitCode, nil
	case <-time.After(timeout):
		c.Process.Kill()
		onLine(fmt.Sprintf("\nTIMEOUT: comando excedeu %ds e foi encerrado.", timeoutSec))
		return -1, fmt.Errorf("timeout")
	}
}

func runScript(msg ScriptRunMsg, sendProgress func(ScriptProgressMsg)) {
	nodeMap := make(map[string]ScriptNode)
	for _, n := range msg.Nodes {
		nodeMap[n.ID] = n
	}

	order := topoSort(msg.Nodes, msg.Edges)

	overallStatus := "done"

	for i, nodeID := range order {
		node, ok := nodeMap[nodeID]
		if !ok {
			continue
		}

		label := node.Data.Label
		if label == "" {
			label = node.Type
		}

		isLast := i == len(order)-1

		// Nó de notificação — apenas visual, sem execução
		if node.Type == "notify" {
			exitCode := 0
			sendProgress(ScriptProgressMsg{
				Type:      "script_progress",
				RunID:     msg.RunID,
				ResultID:  msg.ResultID,
				NodeID:    nodeID,
				NodeLabel: label,
				Status:    "done",
				Output:    node.Data.Message + "\n",
				ExitCode:  &exitCode,
				AllDone:   isLast,
			})
			continue
		}

		// Anuncia início do nó
		sendProgress(ScriptProgressMsg{
			Type:      "script_progress",
			RunID:     msg.RunID,
			ResultID:  msg.ResultID,
			NodeID:    nodeID,
			NodeLabel: label,
			Status:    "running",
			Output:    "",
			AllDone:   false,
		})

		var exitCode int
		// finalOutput é o output enviado NA mensagem de conclusão do nó.
		// Para shell/download, o output já foi streamado linha a linha — a msg final fica vazia.
		// Para tipos desconhecidos, enviamos o erro direto na msg final.
		var finalOutput string

		streamLine := func(line string) {
			sendProgress(ScriptProgressMsg{
				Type:      "script_progress",
				RunID:     msg.RunID,
				ResultID:  msg.ResultID,
				NodeID:    nodeID,
				NodeLabel: label,
				Status:    "running",
				Output:    line + "\n",
				AllDone:   false,
			})
		}

		switch node.Type {
		case "shell":
			exitCode, _ = runShellNodeStreaming(node.Data.Command, node.Data.PowerShell, node.Data.TimeoutSeconds, streamLine)

		case "download":
			dest := node.Data.Destination
			if dest == "" {
				dest = `C:\Temp\` + lastPathSegment(node.Data.URL)
			}
			psCmd := fmt.Sprintf(
				`$ProgressPreference='SilentlyContinue'; New-Item -ItemType Directory -Force -Path (Split-Path '%s') | Out-Null; Invoke-WebRequest -Uri '%s' -OutFile '%s' -UseBasicParsing; Write-Host "Download concluido: %s"`,
				dest, node.Data.URL, dest, dest,
			)
			exitCode, _ = runShellNodeStreaming(psCmd, true, node.Data.TimeoutSeconds, streamLine)

		default:
			finalOutput = "Tipo de nó desconhecido: " + node.Type + "\n"
			exitCode = -1
		}

		nodeStatus := "done"
		if exitCode != 0 {
			nodeStatus = "failed"
			overallStatus = "failed"
		}

		sendProgress(ScriptProgressMsg{
			Type:      "script_progress",
			RunID:     msg.RunID,
			ResultID:  msg.ResultID,
			NodeID:    nodeID,
			NodeLabel: label,
			Status:    nodeStatus,
			Output:    finalOutput,
			ExitCode:  &exitCode,
			AllDone:   isLast,
		})

		// Para na falha para não executar nós dependentes com estado inconsistente
		if nodeStatus == "failed" {
			// Marca nós restantes como skipped
			for _, remainingID := range order[i+1:] {
				rem, ok := nodeMap[remainingID]
				if !ok {
					continue
				}
				remLabel := rem.Data.Label
				if remLabel == "" {
					remLabel = rem.Type
				}
				skippedCode := -1
				sendProgress(ScriptProgressMsg{
					Type:      "script_progress",
					RunID:     msg.RunID,
					ResultID:  msg.ResultID,
					NodeID:    remainingID,
					NodeLabel: remLabel,
					Status:    "failed",
					Output:    "Pulado devido a falha em passo anterior.\n",
					ExitCode:  &skippedCode,
					AllDone:   false,
				})
			}
			// Envia all_done com status de falha
			sendProgress(ScriptProgressMsg{
				Type:      "script_progress",
				RunID:     msg.RunID,
				ResultID:  msg.ResultID,
				NodeID:    nodeID,
				NodeLabel: label,
				Status:    overallStatus,
				Output:    "",
				AllDone:   true,
			})
			return
		}
	}

	// Tudo concluído
	if len(order) == 0 {
		sendProgress(ScriptProgressMsg{
			Type:     "script_progress",
			RunID:    msg.RunID,
			ResultID: msg.ResultID,
			Status:   "done",
			AllDone:  true,
		})
	}
}

func lastPathSegment(u string) string {
	parts := strings.Split(u, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		if parts[i] != "" {
			return parts[i]
		}
	}
	return "download"
}

// ── Loop de conexão WebSocket ────────────────────────────────────────────────

func connect(uuid string) {
	wsURL := strings.Replace(apiURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	host, _ := os.Hostname()
	query := url.Values{}
	query.Set("uuid", uuid)
	query.Set("hostname", host)
	query.Set("rustdesk_id", getRustDeskID())
	query.Set("os", "Windows")
	if tenantID != "" {
		query.Set("tenant_id", tenantID)
	}
	wsURL += "/ws/agent?" + query.Encode()

	dialer := websocket.DefaultDialer
	var mu sync.Mutex

	for {
		conn, _, err := dialer.Dial(wsURL, nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[agent] conexão falhou: %v — tentando em 10s\n", err)
			time.Sleep(10 * time.Second)
			continue
		}
		fmt.Fprintf(os.Stdout, "[agent] conectado ao plus-api (%s)\n", wsURL)

		sendRaw := func(data []byte) {
			mu.Lock()
			defer mu.Unlock()
			conn.WriteMessage(websocket.TextMessage, data)
		}

		sendResult := func(r Result) {
			data, _ := json.Marshal(r)
			sendRaw(data)
		}

		sendProgress := func(p ScriptProgressMsg) {
			data, _ := json.Marshal(p)
			sendRaw(data)
		}

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				fmt.Fprintf(os.Stderr, "[agent] conexão perdida: %v\n", err)
				break
			}

			// Detecta tipo da mensagem
			var envelope struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(msg, &envelope); err != nil {
				continue
			}

			switch envelope.Type {
			case "script_run":
				var scriptMsg ScriptRunMsg
				if err := json.Unmarshal(msg, &scriptMsg); err == nil {
					fmt.Fprintf(os.Stdout, "[agent] executando script run_id=%s\n", scriptMsg.RunID)
					go runScript(scriptMsg, sendProgress)
				}
			default:
				// Formato legado: { job_id, cmd, powershell }
				var cmd Command
				if err := json.NewDecoder(bytes.NewReader(msg)).Decode(&cmd); err == nil && cmd.JobID != "" {
					fmt.Fprintf(os.Stdout, "[agent] executando job %s: %q\n", cmd.JobID, cmd.Cmd)
					go runCommand(cmd, sendResult)
				}
			}
		}

		conn.Close()
		fmt.Fprintln(os.Stdout, "[agent] reconectando em 5s...")
		time.Sleep(5 * time.Second)
	}
}

func main() {
	uuid := getDeviceUUID()
	fmt.Fprintf(os.Stdout, "[agent] iniciando — UUID: %s\n", uuid)
	connect(uuid)
}
