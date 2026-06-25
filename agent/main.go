package main

// Agente RustDesk Plus — roda como serviço Windows em cada PC gerenciado.
// Conecta ao plus-api via WebSocket e executa comandos remotos.
//
// Build:
//   go build -ldflags "-X main.apiURL=http://SEU_IP:21114 -X main.deviceUUID=AUTO" -o rustdesk-agent.exe .
//
// O deviceUUID é lido do RustDesk2.toml se não for injetado via ldflags.

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
	deviceUUID = "" // se vazio, lido do RustDesk2.toml
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

// ── Protocolo ────────────────────────────────────────────────────────────────

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

// ── Execução de comando ──────────────────────────────────────────────────────

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
	wsURL += "/ws/agent?" + query.Encode()

	dialer := websocket.DefaultDialer

	for {
		conn, _, err := dialer.Dial(wsURL, nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[agent] conexão falhou: %v — tentando em 10s\n", err)
			time.Sleep(10 * time.Second)
			continue
		}
		fmt.Fprintf(os.Stdout, "[agent] conectado ao plus-api (%s)\n", wsURL)

		send := func(r Result) {
			data, _ := json.Marshal(r)
			conn.WriteMessage(websocket.TextMessage, data)
		}

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				fmt.Fprintf(os.Stderr, "[agent] conexão perdida: %v\n", err)
				break
			}
			var cmd Command
			if err := json.NewDecoder(bytes.NewReader(msg)).Decode(&cmd); err != nil {
				continue
			}
			fmt.Fprintf(os.Stdout, "[agent] executando job %s: %q\n", cmd.JobID, cmd.Cmd)
			go runCommand(cmd, send)
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
