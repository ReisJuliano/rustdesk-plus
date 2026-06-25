package main

// Instalador RustDesk Plus — janela Win32 nativa com barra de progresso.
//
// Build (no diretório b:\Newrust):
//   go build -C installer -H windowsgui ^
//     -ldflags "-X main.serverIP=IP -X main.serverKey=KEY -X main.apiURL=URL" ^
//     -o ..\rustdesk-installer.exe .

import (
	_ "embed"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ── Config injetado em build ──────────────────────────────────────────────────
var (
	serverIP           = ""
	serverKey          = ""
	apiURL             = ""
	unattendedPassword = ""
)

const rustdeskDownload = "https://github.com/rustdesk/rustdesk/releases/download/1.3.9/rustdesk-1.3.9-x86_64.exe"
const rustdeskExe = `C:\Program Files\RustDesk\rustdesk.exe`
const agentDir = `C:\Program Files\RustDesk Plus`
const agentExe = agentDir + `\rustdesk-agent.exe`
const agentTask = "RustDeskPlusAgent"

//go:embed rustdesk-agent.exe
var embeddedAgent []byte

// ── Win32 DLLs + Procs ───────────────────────────────────────────────────────
var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	comctl32 = windows.NewLazySystemDLL("comctl32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")

	_RegisterClassExW     = user32.NewProc("RegisterClassExW")
	_CreateWindowExW      = user32.NewProc("CreateWindowExW")
	_ShowWindow           = user32.NewProc("ShowWindow")
	_UpdateWindow         = user32.NewProc("UpdateWindow")
	_GetMessageW          = user32.NewProc("GetMessageW")
	_TranslateMessage     = user32.NewProc("TranslateMessage")
	_DispatchMessageW     = user32.NewProc("DispatchMessageW")
	_DefWindowProcW       = user32.NewProc("DefWindowProcW")
	_PostQuitMessage      = user32.NewProc("PostQuitMessage")
	_PostMessageW         = user32.NewProc("PostMessageW")
	_SendMessageW         = user32.NewProc("SendMessageW")
	_SetWindowTextW       = user32.NewProc("SetWindowTextW")
	_EnableWindow         = user32.NewProc("EnableWindow")
	_MessageBoxW          = user32.NewProc("MessageBoxW")
	_LoadCursorW          = user32.NewProc("LoadCursorW")
	_GetModuleHandleW     = kernel32.NewProc("GetModuleHandleW")
	_CreateSolidBrush     = gdi32.NewProc("CreateSolidBrush")
	_DeleteObject         = gdi32.NewProc("DeleteObject")
	_FillRect             = user32.NewProc("FillRect")
	_BeginPaint           = user32.NewProc("BeginPaint")
	_EndPaint             = user32.NewProc("EndPaint")
	_SetTextColor         = gdi32.NewProc("SetTextColor")
	_SetBkColor           = gdi32.NewProc("SetBkColor")
	_SetBkMode            = gdi32.NewProc("SetBkMode")
	_CreateFontW          = gdi32.NewProc("CreateFontW")
	_SelectObject         = gdi32.NewProc("SelectObject")
	_TextOutW             = gdi32.NewProc("TextOutW")
	_GetClientRect        = user32.NewProc("GetClientRect")
	_MoveWindow           = user32.NewProc("MoveWindow")
	_GetSystemMetrics     = user32.NewProc("GetSystemMetrics")
	_SetWindowPos         = user32.NewProc("SetWindowPos")
	_GetWindowRect        = user32.NewProc("GetWindowRect")
	_InitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	_ShellExecuteW        = shell32.NewProc("ShellExecuteW")
)

// ── Constantes Win32 ─────────────────────────────────────────────────────────
const (
	WS_OVERLAPPED       = 0x00000000
	WS_CAPTION          = 0x00C00000
	WS_SYSMENU          = 0x00080000
	WS_MINIMIZEBOX      = 0x00020000
	WS_VISIBLE          = 0x10000000
	WS_CHILD            = 0x40000000
	WS_OVERLAPPEDWINDOW = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX

	BS_PUSHBUTTON    = 0x00000000
	BS_DEFPUSHBUTTON = 0x00000001

	PBS_SMOOTH = 0x01
	PBM_SETRANGE32 = 0x0406
	PBM_SETPOS   = 0x0402

	WM_CREATE          = 0x0001
	WM_DESTROY         = 0x0002
	WM_PAINT           = 0x000F
	WM_COMMAND         = 0x0111
	WM_CLOSE           = 0x0010
	WM_CTLCOLORSTATIC  = 0x0138
	WM_USER            = 0x0400
	WM_APP_STATUS      = WM_USER + 1
	WM_APP_PROGRESS    = WM_USER + 2
	WM_APP_DONE        = WM_USER + 3
	WM_APP_ERROR       = WM_USER + 4

	IDC_ARROW   = 32512
	ICC_PROGRESS_CLASS = 0x20
	TRANSPARENT = 1
	SW_SHOW     = 5

	ID_BTN  = 101
	ID_PROG = 102
	ID_STAT = 103

	MB_OK        = 0x00000000
	MB_ICONERROR = 0x00000010
	MB_ICONINFO  = 0x00000040

	SWP_NOMOVE = 0x0002
)

// ── Structs Win32 ─────────────────────────────────────────────────────────────
type WNDCLASSEX struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type MSG struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      [2]int32
}

type RECT struct{ Left, Top, Right, Bottom int32 }

type PAINTSTRUCT struct {
	Hdc         uintptr
	FErase      int32
	RcPaint     RECT
	FRestore    int32
	FIncUpdate  int32
	RgbReserved [32]byte
}

type INITCOMMONCONTROLSEX struct {
	DwSize uint32
	DwICC  uint32
}

// ── Globals ───────────────────────────────────────────────────────────────────
var (
	hwndMain uintptr
	hwndBtn  uintptr
	hwndProg uintptr
	hwndStat uintptr
	hInst    uintptr
	hFont    uintptr
	hFontBig uintptr
	hBrushBg uintptr // branco
	hBrushHdr uintptr // azul header
	installing bool
)

const winW, winH = 460, 300
const headerH = 80

// ── Entry Point ───────────────────────────────────────────────────────────────
func main() {
	if serverIP == "" {
		msgBox(0, "Este instalador não foi compilado com as configurações do servidor.\n\nCompile com os ldflags corretos.", "Erro", MB_ICONERROR|MB_OK)
		return
	}

	if !windows.GetCurrentProcessToken().IsElevated() {
		relaunchAsAdmin()
		return
	}

	icc := INITCOMMONCONTROLSEX{DwSize: 8, DwICC: ICC_PROGRESS_CLASS}
	_InitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	hInst, _, _ = _GetModuleHandleW.Call(0)
	hBrushBg, _, _ = _CreateSolidBrush.Call(0x00FFFFFF)  // branco
	hBrushHdr, _, _ = _CreateSolidBrush.Call(0x001D4ED8) // azul #1D4ED8 (blue-700)

	cursor, _, _ := _LoadCursorW.Call(0, IDC_ARROW)

	className, _ := windows.UTF16PtrFromString("RustDeskPlusInstaller")
	wc := WNDCLASSEX{
		CbSize:        uint32(unsafe.Sizeof(WNDCLASSEX{})),
		LpfnWndProc:   syscall.NewCallback(wndProc),
		HInstance:     hInst,
		HCursor:       cursor,
		HbrBackground: hBrushBg,
		LpszClassName: className,
	}
	_RegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	// Centraliza na tela
	sm_cx, _, _ := _GetSystemMetrics.Call(0)
	sm_cy, _, _ := _GetSystemMetrics.Call(1)
	x := (int(sm_cx) - winW) / 2
	y := (int(sm_cy) - winH) / 2

	title, _ := windows.UTF16PtrFromString("RustDesk Plus — Instalador")
	hwndMain, _, _ = _CreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
		WS_OVERLAPPEDWINDOW&^0x00040000, // sem resize
		uintptr(x), uintptr(y),
		winW, winH,
		0, 0, hInst, 0,
	)

	_ShowWindow.Call(hwndMain, SW_SHOW)
	_UpdateWindow.Call(hwndMain)

	var msg MSG
	for {
		r, _, _ := _GetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if r == 0 { break }
		_TranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		_DispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

// ── Window Procedure ──────────────────────────────────────────────────────────
func wndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_CREATE:
		createControls(hwnd)

	case WM_PAINT:
		var ps PAINTSTRUCT
		hdc, _, _ := _BeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		drawHeader(hdc)
		_EndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0

	case WM_CTLCOLORSTATIC:
		// Fundo branco para labels
		_SetBkColor.Call(wParam, 0x00FFFFFF)
		_SetBkMode.Call(wParam, TRANSPARENT)
		_SetTextColor.Call(wParam, 0x00374151) // slate-700
		return hBrushBg

	case WM_COMMAND:
		id := wParam & 0xFFFF
		if id == ID_BTN && !installing {
			installing = true
			_EnableWindow.Call(hwndBtn, 0)
			go runInstall(hwnd)
		}

	case WM_APP_STATUS:
		text := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(lParam)))
		setWinText(hwndStat, text)

	case WM_APP_PROGRESS:
		_SendMessageW.Call(hwndProg, PBM_SETPOS, wParam, 0)

	case WM_APP_DONE:
		setWinText(hwndBtn, "Concluído ✓")
		msgBox(hwnd, "RustDesk instalado e configurado!\n\nEste PC aparecerá no dashboard em instantes.", "Sucesso", MB_ICONINFO|MB_OK)
		_PostQuitMessage.Call(0)

	case WM_APP_ERROR:
		text := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(lParam)))
		installing = false
		_EnableWindow.Call(hwndBtn, 1)
		setWinText(hwndBtn, "Tentar novamente")
		msgBox(hwnd, "Erro: "+text, "Erro na instalação", MB_ICONERROR|MB_OK)

	case WM_CLOSE:
		_PostQuitMessage.Call(0)
	}
	r, _, _ := _DefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

// ── Criar controles filhos ────────────────────────────────────────────────────
func createControls(hwnd uintptr) {
	hFont = createFont(14, false)
	hFontBig = createFont(16, true)

	staticClass, _ := windows.UTF16PtrFromString("STATIC")
	btnClass, _ := windows.UTF16PtrFromString("BUTTON")
	progClass, _ := windows.UTF16PtrFromString("msctls_progress32")

	pad := 30

	// Status label
	statText, _ := windows.UTF16PtrFromString("Clique em Instalar para começar.")
	hwndStat, _, _ = _CreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(staticClass)),
		uintptr(unsafe.Pointer(statText)),
		WS_CHILD|WS_VISIBLE,
		uintptr(pad), uintptr(headerH+20),
		uintptr(winW-pad*2), 22,
		hwnd, ID_STAT, hInst, 0,
	)
	_SendMessageW.Call(hwndStat, 0x0030, hFont, 1) // WM_SETFONT

	// Progress bar
	hwndProg, _, _ = _CreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(progClass)),
		0,
		WS_CHILD|WS_VISIBLE|PBS_SMOOTH,
		uintptr(pad), uintptr(headerH+55),
		uintptr(winW-pad*2), 22,
		hwnd, ID_PROG, hInst, 0,
	)
	_SendMessageW.Call(hwndProg, PBM_SETRANGE32, 0, 100)
	_SendMessageW.Call(hwndProg, PBM_SETPOS, 0, 0)

	// Install button
	btnText, _ := windows.UTF16PtrFromString("  Instalar  ")
	hwndBtn, _, _ = _CreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(btnClass)),
		uintptr(unsafe.Pointer(btnText)),
		WS_CHILD|WS_VISIBLE|BS_DEFPUSHBUTTON,
		uintptr((winW-160)/2), uintptr(headerH+100),
		160, 36,
		hwnd, ID_BTN, hInst, 0,
	)
	_SendMessageW.Call(hwndBtn, 0x0030, hFontBig, 1)
}

// ── Desenha cabeçalho azul ────────────────────────────────────────────────────
func drawHeader(hdc uintptr) {
	r := RECT{0, 0, winW, headerH}
	_FillRect.Call(hdc, uintptr(unsafe.Pointer(&r)), hBrushHdr)

	_SetBkMode.Call(hdc, TRANSPARENT)
	_SetTextColor.Call(hdc, 0x00FFFFFF)

	title, _ := windows.UTF16PtrFromString("RustDesk Plus")
	hf := createFont(20, true)
	old, _, _ := _SelectObject.Call(hdc, hf)
	_TextOutW.Call(hdc, 20, 15, uintptr(unsafe.Pointer(title)), uintptr(len("RustDesk Plus")))
	_SelectObject.Call(hdc, old)
	_DeleteObject.Call(hf)

	sub, _ := windows.UTF16PtrFromString("Instalador de Configuração Automática")
	hf2 := createFont(13, false)
	old2, _, _ := _SelectObject.Call(hdc, hf2)
	_SetTextColor.Call(hdc, 0x00BFDBFE) // blue-200
	_TextOutW.Call(hdc, 20, 44, uintptr(unsafe.Pointer(sub)), uintptr(len("Instalador de Configuração Automática")))
	_SelectObject.Call(hdc, old2)
	_DeleteObject.Call(hf2)
}

// ── Instalação em goroutine ───────────────────────────────────────────────────
func runInstall(hwnd uintptr) {
	status := func(s string, pct int) {
		p, _ := windows.UTF16PtrFromString(s)
		_PostMessageW.Call(hwnd, WM_APP_STATUS, 0, uintptr(unsafe.Pointer(p)))
		_PostMessageW.Call(hwnd, WM_APP_PROGRESS, uintptr(pct), 0)
	}
	fail := func(s string) {
		p, _ := windows.UTF16PtrFromString(s)
		_PostMessageW.Call(hwnd, WM_APP_ERROR, 0, uintptr(unsafe.Pointer(p)))
	}

	// Para qualquer instância existente ANTES de mexer em qualquer arquivo de configuração.
	// O serviço roda como SYSTEM; se não parar agora, o novo config será ignorado.
	status("Parando RustDesk existente...", 5)
	stopRustDeskProcesses()

	if _, err := os.Stat(rustdeskExe); os.IsNotExist(err) {
		status("Baixando RustDesk (pode demorar)...", 10)
		tmp := filepath.Join(os.TempDir(), "rustdesk-setup.exe")
		if err := downloadWithProgress(rustdeskDownload, tmp, func(pct int) {
			status(fmt.Sprintf("Baixando RustDesk... %d%%", pct), 10+pct/3)
		}); err != nil {
			fail("Falha no download: " + err.Error()); return
		}
		status("Instalando RustDesk...", 45)
		cmd := exec.Command(tmp, "--silent-install")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := cmd.Run(); err != nil {
			fail("Falha na instalação: " + err.Error()); return
		}
		// Mata o RustDesk que o instalador pode ter abierto, e reaplica parada
		stopRustDeskProcesses()
	}

	// Limpa TODOS os diretórios de config antes de escrever o novo — garante que
	// senhas e configurações antigas (inclusive no perfil SYSTEM) não sobrevivam.
	status("Limpando configuração antiga...", 65)
	clearRustDeskConfigDirs()

	status("Aplicando configuração do servidor...", 70)
	appData, _ := os.UserConfigDir()
	configDir := filepath.Join(appData, "RustDesk", "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		fail("Erro ao criar diretório de config: " + err.Error()); return
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "rendezvous_server = '%s:21116'\n", serverIP)
	sb.WriteString("nat_type = 1\nserial = 0\n\n[options]\n")
	fmt.Fprintf(&sb, "key = '%s'\n", serverKey)
	fmt.Fprintf(&sb, "custom-rendezvous-server = '%s'\n", serverIP)
	fmt.Fprintf(&sb, "relay-server = '%s'\n", serverIP)
	if apiURL != "" {
		fmt.Fprintf(&sb, "api-server = '%s'\n", apiURL)
	}
	// permanent-password é gravado direto no TOML — o RustDesk o armazena como
	// texto puro em [options]. Não usamos rustdesk --password porque esse comando
	// precisa do serviço rodando (IPC) e falharia em silêncio aqui.
	if unattendedPassword != "" {
		fmt.Fprintf(&sb, "permanent-password = '%s'\n", unattendedPassword)
	}
	if err := os.WriteFile(filepath.Join(configDir, "RustDesk2.toml"), []byte(sb.String()), 0644); err != nil {
		fail("Erro ao salvar config: " + err.Error()); return
	}
	if err := applyRustDeskOptions(); err != nil {
		fail("Erro ao aplicar a configuração no RustDesk: " + err.Error()); return
	}

	// Copia toda a config do perfil do usuário atual para o perfil SYSTEM,
	// pois o serviço do Windows roda como SYSTEM e leria o config antigo.
	status("Propagando configuração para o serviço...", 80)
	propagateConfigToSystemProfile()

	status("Instalando agente de gerenciamento...", 82)
	if err := installAgent(); err != nil {
		fail("Erro ao instalar o agente: " + err.Error()); return
	}

	status("Configurando serviço de inicialização...", 90)
	installRustDeskService()

	status("Iniciando RustDesk...", 95)
	exec.Command(rustdeskExe).Start()

	status("Instalação concluída!", 100)
	_PostMessageW.Call(hwnd, WM_APP_DONE, 0, 0)
}

func applyRustDeskOptions() error {
	options := [][2]string{
		{"key", serverKey},
		{"custom-rendezvous-server", serverIP},
		{"relay-server", serverIP},
	}
	if apiURL != "" {
		options = append(options, [2]string{"api-server", apiURL})
	}

	for _, option := range options {
		cmd := exec.Command(rustdeskExe, "--option", option[0], option[1])
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %v: %s", option[0], err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

// clearRustDeskConfigDirs apaga os diretórios de config do usuário atual E do
// perfil SYSTEM antes de escrever os novos. Sem isso, arquivos de senha antigos
// (permanent-password, etc.) ficam no disco e o serviço os usa ao subir.
func clearRustDeskConfigDirs() {
	appData, err := os.UserConfigDir()
	if err == nil {
		userCfg := filepath.Join(appData, "RustDesk", "config")
		os.RemoveAll(userCfg)
		os.MkdirAll(userCfg, 0755)
	}
	for _, dir := range []string{
		`C:\Windows\System32\config\systemprofile\AppData\Roaming\RustDesk\config`,
		`C:\Windows\SysWOW64\config\systemprofile\AppData\Roaming\RustDesk\config`,
	} {
		os.RemoveAll(dir)
	}
}

func stopRustDeskProcesses() {
	// Para o serviço (pode falhar se não existir — ignoramos)
	svcStop := exec.Command("sc", "stop", "RustDesk")
	svcStop.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	svcStop.Run()
	// Mata o processo de UI
	kill := exec.Command("taskkill", "/F", "/IM", "rustdesk.exe")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	kill.Run()
	// Aguarda os processos terminarem de fato antes de mexer nos arquivos
	time.Sleep(1500 * time.Millisecond)
}

// propagateConfigToSystemProfile copia os arquivos de configuração do perfil
// do usuário atual para o perfil SYSTEM (onde o serviço do Windows os lê).
func propagateConfigToSystemProfile() {
	appData, err := os.UserConfigDir()
	if err != nil {
		return
	}
	srcDir := filepath.Join(appData, "RustDesk", "config")
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return
	}
	// Ambos os caminhos do perfil SYSTEM (64-bit e 32-bit)
	dsts := []string{
		`C:\Windows\System32\config\systemprofile\AppData\Roaming\RustDesk\config`,
		`C:\Windows\SysWOW64\config\systemprofile\AppData\Roaming\RustDesk\config`,
	}
	for _, dst := range dsts {
		os.RemoveAll(dst)
		if err := os.MkdirAll(dst, 0755); err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			data, err := os.ReadFile(filepath.Join(srcDir, e.Name()))
			if err != nil {
				continue
			}
			os.WriteFile(filepath.Join(dst, e.Name()), data, 0644)
		}
	}
}

func setRustDeskPassword(password string) error {
	cmd := exec.Command(rustdeskExe, "--password", password)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func installRustDeskService() {
	// Instala o serviço caso ainda não exista
	svcInstall := exec.Command(rustdeskExe, "--install-service")
	svcInstall.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	svcInstall.Run()

	// Garante que o serviço inicia junto com o Windows
	scConfig := exec.Command("sc", "config", "RustDesk", "start=", "auto")
	scConfig.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	scConfig.Run()

	// Inicia o serviço (ignora erro caso já esteja rodando)
	scStart := exec.Command("sc", "start", "RustDesk")
	scStart.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	scStart.Run()
}

func installAgent() error {
	if len(embeddedAgent) == 0 {
		return fmt.Errorf("agente não foi incluído no instalador")
	}
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		return err
	}

	exec.Command("schtasks", "/End", "/TN", agentTask).Run()
	exec.Command("taskkill", "/F", "/IM", "rustdesk-agent.exe").Run()

	if err := os.WriteFile(agentExe, embeddedAgent, 0755); err != nil {
		return err
	}

	taskCommand := fmt.Sprintf(`"%s"`, agentExe)
	create := exec.Command(
		"schtasks",
		"/Create",
		"/TN", agentTask,
		"/TR", taskCommand,
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/F",
	)
	create.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := create.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
	}

	start := exec.Command("schtasks", "/Run", "/TN", agentTask)
	start.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := start.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────
func createFont(size int, bold bool) uintptr {
	weight := 400
	if bold { weight = 700 }
	face, _ := windows.UTF16PtrFromString("Segoe UI")
	h, _, _ := _CreateFontW.Call(
		uintptr(size), 0, 0, 0,
		uintptr(weight),
		0, 0, 0, 1, 0, 0, 4, 0,
		uintptr(unsafe.Pointer(face)),
	)
	return h
}

func setWinText(hwnd uintptr, s string) {
	p, _ := windows.UTF16PtrFromString(s)
	_SetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(p)))
}

func msgBox(owner uintptr, text, title string, flags uint32) {
	t, _ := windows.UTF16PtrFromString(text)
	tt, _ := windows.UTF16PtrFromString(title)
	_MessageBoxW.Call(owner, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(tt)), uintptr(flags))
}

func relaunchAsAdmin() {
	exe, _ := os.Executable()
	verb, _ := windows.UTF16PtrFromString("runas")
	file, _ := windows.UTF16PtrFromString(exe)

	type shellExInfo struct {
		cbSize         uint32
		fMask          uint32
		hwnd           uintptr
		lpVerb         *uint16
		lpFile         *uint16
		lpParameters   *uint16
		lpDirectory    *uint16
		nShow          int32
		hInstApp       uintptr
		lpIDList       uintptr
		lpClass        *uint16
		hkeyClass      uintptr
		dwHotKey       uint32
		hIconOrMonitor uintptr
		hProcess       uintptr
	}
	info := shellExInfo{
		fMask:   0x00000040,
		lpVerb:  verb,
		lpFile:  file,
		nShow:   SW_SHOW,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	_ShellExecuteW.Call(0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		0, 0, SW_SHOW,
	)
}

func downloadWithProgress(url, dest string, progress func(int)) error {
	resp, err := http.Get(url)
	if err != nil { return err }
	defer resp.Body.Close()

	f, err := os.Create(dest)
	if err != nil { return err }
	defer f.Close()

	total := resp.ContentLength
	var done int64
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			f.Write(buf[:n])
			done += int64(n)
			if total > 0 {
				progress(int(float64(done) / float64(total) * 100))
			}
		}
		if err == io.EOF { return nil }
		if err != nil { return err }
	}
}
