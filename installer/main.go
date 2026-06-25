package main

// Instalador RustDesk Plus — janela Win32 nativa profissional.
//
// Build (no diretório b:\Newrust):
//   go build -C installer -H windowsgui ^
//     -ldflags "-X main.serverIP=IP -X main.serverKey=KEY -X main.apiURL=URL -X main.tenantID=UUID -X main.unattendedPassword=PASS" ^
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
	tenantID           = ""
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
	_GetSystemMetrics     = user32.NewProc("GetSystemMetrics")
	_InitCommonControlsEx = comctl32.NewProc("InitCommonControlsEx")
	_ShellExecuteW        = shell32.NewProc("ShellExecuteW")
	_InvalidateRect       = user32.NewProc("InvalidateRect")
	_Ellipse              = gdi32.NewProc("Ellipse")
	_CreatePen            = gdi32.NewProc("CreatePen")
	_GetStockObject       = gdi32.NewProc("GetStockObject")
	_Rectangle            = gdi32.NewProc("Rectangle")
	_SetPixel             = gdi32.NewProc("SetPixel")
	_MoveToEx             = gdi32.NewProc("MoveToEx")
	_LineTo               = gdi32.NewProc("LineTo")
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

	BS_DEFPUSHBUTTON = 0x00000001

	WM_CREATE         = 0x0001
	WM_DESTROY        = 0x0002
	WM_PAINT          = 0x000F
	WM_COMMAND        = 0x0111
	WM_CLOSE          = 0x0010
	WM_CTLCOLORSTATIC = 0x0138
	WM_USER           = 0x0400
	WM_APP_STATUS     = WM_USER + 1
	WM_APP_PROGRESS   = WM_USER + 2
	WM_APP_DONE       = WM_USER + 3
	WM_APP_ERROR      = WM_USER + 4
	WM_APP_STEP       = WM_USER + 5

	IDC_ARROW         = 32512
	ICC_PROGRESS_CLASS = 0x20
	TRANSPARENT        = 1
	OPAQUE             = 2
	SW_SHOW            = 5
	NULL_BRUSH         = 5
	PS_SOLID           = 0

	ID_BTN  = 101
	ID_STAT = 103

	MB_OK        = 0x00000000
	MB_ICONERROR = 0x00000010
	MB_ICONINFO  = 0x00000040
)

// ── Cores (Win32 BGR) ─────────────────────────────────────────────────────────
const (
	clrHeaderBg  = 0x002A170F // #0F172A slate-900
	clrHeaderBdr = 0x00332620 // #202633 slightly lighter
	clrBodyBg    = 0x00FCFAF8 // #F8FAFC slate-50
	clrCardBg    = 0x00FFFFFF // white
	clrAccent    = 0x00EB6325 // #2563EB blue-600
	clrAccentDk  = 0x00B85115 // #1551B8 blue-700
	clrSuccess   = 0x0081B910 // #10B981 emerald-500
	clrPending   = 0x00D4C4B8 // #B8C4D4 slate-300
	clrText      = 0x00332920 // #202933 slate-800
	clrSubtext   = 0x00B8A394 // #94A3B8 slate-400
	clrMuted     = 0x008B7464 // #64748B slate-500
	clrBorder    = 0x00E8E0DC // #DCE0E8 slate-200
	clrWhite     = 0x00FFFFFF
	clrProgBg    = 0x00E8E0DC // progress track
	clrError     = 0x006060DC // #DC6060
)

// ── Geometria ─────────────────────────────────────────────────────────────────
const (
	winW   = 560
	winH   = 430
	hdrH   = 96
	padX   = 44
	stepY0 = 118
	stepDY = 44
)

var stepLabels = [4]string{
	"Parar processos existentes",
	"Baixar e instalar RustDesk",
	"Configurar servidor e senha",
	"Ativar serviço de inicialização",
}

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
	hwndMain  uintptr
	hwndBtn   uintptr
	hwndStat  uintptr
	hInst     uintptr
	hBrushBg  uintptr // body bg
	hBrushHdr uintptr // header bg
	installing bool
	currentStep int // 0=idle 1-4=active step 5=done 6=error
	progressPct int // 0-100
)

// ── Entry Point ───────────────────────────────────────────────────────────────
func main() {
	if serverIP == "" || tenantID == "" {
		msgBox(0, "Este instalador não foi configurado corretamente.\n\nBaixe o instalador pelo painel de gerenciamento.", "Erro de Configuração", MB_ICONERROR|MB_OK)
		return
	}

	if !windows.GetCurrentProcessToken().IsElevated() {
		relaunchAsAdmin()
		return
	}

	icc := INITCOMMONCONTROLSEX{DwSize: 8, DwICC: ICC_PROGRESS_CLASS}
	_InitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))

	hInst, _, _ = _GetModuleHandleW.Call(0)
	hBrushBg, _, _ = _CreateSolidBrush.Call(clrBodyBg)
	hBrushHdr, _, _ = _CreateSolidBrush.Call(clrHeaderBg)

	cursor, _, _ := _LoadCursorW.Call(0, IDC_ARROW)
	className, _ := windows.UTF16PtrFromString("RDPlusInstaller")
	wc := WNDCLASSEX{
		CbSize:        uint32(unsafe.Sizeof(WNDCLASSEX{})),
		LpfnWndProc:   syscall.NewCallback(wndProc),
		HInstance:     hInst,
		HCursor:       cursor,
		HbrBackground: hBrushBg,
		LpszClassName: className,
	}
	_RegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	sm_cx, _, _ := _GetSystemMetrics.Call(0)
	sm_cy, _, _ := _GetSystemMetrics.Call(1)
	x := (int(sm_cx) - winW) / 2
	y := (int(sm_cy) - winH) / 2

	title, _ := windows.UTF16PtrFromString("RustDesk Plus — Instalação")
	hwndMain, _, _ = _CreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(title)),
		WS_OVERLAPPEDWINDOW&^0x00040000,
		uintptr(x), uintptr(y),
		winW, winH,
		0, 0, hInst, 0,
	)

	_ShowWindow.Call(hwndMain, SW_SHOW)
	_UpdateWindow.Call(hwndMain)

	var msg MSG
	for {
		r, _, _ := _GetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if r == 0 {
			break
		}
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
		paintAll(hdc)
		_EndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0

	case WM_CTLCOLORSTATIC:
		_SetBkMode.Call(wParam, TRANSPARENT)
		_SetTextColor.Call(wParam, clrMuted)
		_SetBkColor.Call(wParam, clrBodyBg)
		return hBrushBg

	case WM_COMMAND:
		id := wParam & 0xFFFF
		if id == ID_BTN && !installing {
			installing = true
			_EnableWindow.Call(hwndBtn, 0)
			setWinText(hwndBtn, "Instalando...")
			go runInstall(hwnd)
		}

	case WM_APP_STATUS:
		text := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(lParam)))
		setWinText(hwndStat, text)

	case WM_APP_PROGRESS:
		progressPct = int(wParam)
		_InvalidateRect.Call(hwnd, 0, 0)

	case WM_APP_STEP:
		currentStep = int(wParam)
		_InvalidateRect.Call(hwnd, 0, 0)

	case WM_APP_DONE:
		currentStep = 5
		progressPct = 100
		_InvalidateRect.Call(hwnd, 0, 0)
		setWinText(hwndBtn, "Concluído  ✓")
		_EnableWindow.Call(hwndBtn, 1)
		msgBox(hwnd,
			"Instalação concluída com sucesso!\n\nEste PC aparecerá no painel de gerenciamento em instantes.\n\nO RustDesk está ativo como serviço do Windows e iniciará automaticamente.",
			"Instalação Concluída", MB_ICONINFO|MB_OK)
		_PostQuitMessage.Call(0)

	case WM_APP_ERROR:
		text := windows.UTF16PtrToString((*uint16)(unsafe.Pointer(lParam)))
		currentStep = 6
		progressPct = 0
		installing = false
		_InvalidateRect.Call(hwnd, 0, 0)
		_EnableWindow.Call(hwndBtn, 1)
		setWinText(hwndBtn, "Tentar novamente")
		msgBox(hwnd, "Falha na instalação:\n\n"+text, "Erro", MB_ICONERROR|MB_OK)

	case WM_CLOSE:
		_PostQuitMessage.Call(0)
	}
	r, _, _ := _DefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

// ── Criar controles ───────────────────────────────────────────────────────────
func createControls(hwnd uintptr) {
	staticClass, _ := windows.UTF16PtrFromString("STATIC")
	btnClass, _ := windows.UTF16PtrFromString("BUTTON")

	// Status label (abaixo das etapas)
	statText, _ := windows.UTF16PtrFromString("Clique em Instalar para começar.")
	hwndStat, _, _ = _CreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(staticClass)),
		uintptr(unsafe.Pointer(statText)),
		WS_CHILD|WS_VISIBLE,
		padX, stepY0+stepDY*4+8,
		uintptr(winW-padX*2), 22,
		hwnd, ID_STAT, hInst, 0,
	)
	hFont := createFont(12, false)
	_SendMessageW.Call(hwndStat, 0x0030, hFont, 1)

	// Botão Instalar — centralizado
	btnText, _ := windows.UTF16PtrFromString("    Instalar    ")
	btnW := 200
	btnH := 42
	btnX := (winW - btnW) / 2
	btnY := stepY0 + stepDY*4 + 50
	hwndBtn, _, _ = _CreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(btnClass)),
		uintptr(unsafe.Pointer(btnText)),
		WS_CHILD|WS_VISIBLE|BS_DEFPUSHBUTTON,
		uintptr(btnX), uintptr(btnY),
		uintptr(btnW), uintptr(btnH),
		hwnd, ID_BTN, hInst, 0,
	)
	hFontBtn := createFont(13, true)
	_SendMessageW.Call(hwndBtn, 0x0030, hFontBtn, 1)
}

// ── Pintura principal ─────────────────────────────────────────────────────────
func paintAll(hdc uintptr) {
	// ── Header ────────────────────────────────────────────────────────────────
	hdrRect := RECT{0, 0, winW, int32(hdrH)}
	_FillRect.Call(hdc, uintptr(unsafe.Pointer(&hdrRect)), hBrushHdr)

	// Linha divisória sutil
	pen1, _, _ := _CreatePen.Call(PS_SOLID, 1, clrHeaderBdr)
	oldPen, _, _ := _SelectObject.Call(hdc, pen1)
	_MoveToEx.Call(hdc, 0, uintptr(hdrH-1), 0)
	_LineTo.Call(hdc, winW, uintptr(hdrH-1))
	_SelectObject.Call(hdc, oldPen)
	_DeleteObject.Call(pen1)

	// Dot decorativo azul
	dotBrush, _, _ := _CreateSolidBrush.Call(clrAccent)
	dotPen, _, _ := _CreatePen.Call(PS_SOLID, 0, clrAccent)
	_SelectObject.Call(hdc, dotBrush)
	_SelectObject.Call(hdc, dotPen)
	_Ellipse.Call(hdc, padX, 28, padX+12, 40)
	_DeleteObject.Call(dotBrush)
	_DeleteObject.Call(dotPen)

	// Título principal
	_SetBkMode.Call(hdc, TRANSPARENT)
	_SetTextColor.Call(hdc, clrWhite)
	hf1 := createFont(20, true)
	old1, _, _ := _SelectObject.Call(hdc, hf1)
	title, _ := windows.UTF16PtrFromString("RustDesk Plus")
	_TextOutW.Call(hdc, padX+20, 22, uintptr(unsafe.Pointer(title)), uintptr(len("RustDesk Plus")))
	_SelectObject.Call(hdc, old1)
	_DeleteObject.Call(hf1)

	// Subtítulo
	_SetTextColor.Call(hdc, clrSubtext)
	hf2 := createFont(12, false)
	old2, _, _ := _SelectObject.Call(hdc, hf2)
	sub, _ := windows.UTF16PtrFromString("Instalação de Acesso Remoto Gerenciado")
	_TextOutW.Call(hdc, padX+20, 50, uintptr(unsafe.Pointer(sub)), uintptr(len("Instalação de Acesso Remoto Gerenciado")))

	// Servidor
	_SetTextColor.Call(hdc, clrMuted)
	srv := "○  " + serverIP
	srvW, _ := windows.UTF16PtrFromString(srv)
	_TextOutW.Call(hdc, padX+20, 70, uintptr(unsafe.Pointer(srvW)), uintptr(len(srv)))
	_SelectObject.Call(hdc, old2)
	_DeleteObject.Call(hf2)

	// ── Corpo ─────────────────────────────────────────────────────────────────
	bodyRect := RECT{0, int32(hdrH), winW, winH}
	_FillRect.Call(hdc, uintptr(unsafe.Pointer(&bodyRect)), hBrushBg)

	// ── Etapas ────────────────────────────────────────────────────────────────
	for i, label := range stepLabels {
		paintStep(hdc, i, label)
	}

	// ── Barra de progresso ────────────────────────────────────────────────────
	if installing || currentStep == 5 {
		progY := stepY0 + stepDY*4 + 32
		progH := 6
		progW := winW - padX*2

		// Track
		trackBrush, _, _ := _CreateSolidBrush.Call(clrProgBg)
		trackR := RECT{int32(padX), int32(progY), int32(padX + progW), int32(progY + progH)}
		_FillRect.Call(hdc, uintptr(unsafe.Pointer(&trackR)), trackBrush)
		_DeleteObject.Call(trackBrush)

		// Fill
		fillW := progressPct * progW / 100
		if fillW > 0 {
			fillColor := clrAccent
			if currentStep == 5 {
				fillColor = clrSuccess
			}
			fillBrush, _, _ := _CreateSolidBrush.Call(uintptr(fillColor))
			fillR := RECT{int32(padX), int32(progY), int32(padX + fillW), int32(progY + progH)}
			_FillRect.Call(hdc, uintptr(unsafe.Pointer(&fillR)), fillBrush)
			_DeleteObject.Call(fillBrush)
		}
	}
}

func paintStep(hdc uintptr, idx int, label string) {
	cx := padX + 12
	cy := stepY0 + idx*stepDY + 12
	r := 12

	// Determina estado
	done := idx < currentStep && currentStep > 0 && currentStep != 6
	active := idx == currentStep-1 && currentStep > 0 && currentStep <= 4
	err := currentStep == 6 && idx == currentStep-1

	// Círculo
	var fillColor, penColor uintptr
	switch {
	case err:
		fillColor, penColor = clrError, clrError
	case done:
		fillColor, penColor = clrSuccess, clrSuccess
	case active:
		fillColor, penColor = clrAccent, clrAccent
	default:
		fillColor, penColor = clrBodyBg, clrPending
	}

	br, _, _ := _CreateSolidBrush.Call(fillColor)
	pn, _, _ := _CreatePen.Call(PS_SOLID, 2, penColor)
	_SelectObject.Call(hdc, br)
	_SelectObject.Call(hdc, pn)
	_Ellipse.Call(hdc, uintptr(cx-r), uintptr(cy-r), uintptr(cx+r), uintptr(cy+r))
	_DeleteObject.Call(br)
	_DeleteObject.Call(pn)

	// Número ou checkmark no círculo
	_SetBkMode.Call(hdc, TRANSPARENT)
	var sym string
	switch {
	case done:
		sym = "✓"
		_SetTextColor.Call(hdc, clrWhite)
	case active:
		sym = fmt.Sprintf("%d", idx+1)
		_SetTextColor.Call(hdc, clrWhite)
	default:
		sym = fmt.Sprintf("%d", idx+1)
		_SetTextColor.Call(hdc, clrPending)
	}
	hfsym := createFont(10, true)
	oldsym, _, _ := _SelectObject.Call(hdc, hfsym)
	symW, _ := windows.UTF16PtrFromString(sym)
	_TextOutW.Call(hdc, uintptr(cx-6), uintptr(cy-7), uintptr(unsafe.Pointer(symW)), uintptr(len(sym)))
	_SelectObject.Call(hdc, oldsym)
	_DeleteObject.Call(hfsym)

	// Texto da etapa
	var textColor uintptr
	var bold bool
	switch {
	case done:
		textColor, bold = clrMuted, false
	case active:
		textColor, bold = clrText, true
	default:
		textColor, bold = clrSubtext, false
	}
	_SetTextColor.Call(hdc, textColor)
	hftxt := createFont(13, bold)
	oldtxt, _, _ := _SelectObject.Call(hdc, hftxt)
	lw, _ := windows.UTF16PtrFromString(label)
	_TextOutW.Call(hdc, uintptr(padX+30), uintptr(cy-9), uintptr(unsafe.Pointer(lw)), uintptr(len(label)))
	_SelectObject.Call(hdc, oldtxt)
	_DeleteObject.Call(hftxt)

	// Linha conectora entre etapas
	if idx < len(stepLabels)-1 {
		lnBrush, _, _ := _CreateSolidBrush.Call(clrBorder)
		lnR := RECT{int32(cx - 1), int32(cy + r), int32(cx + 1), int32(cy + r + stepDY - r*2)}
		_FillRect.Call(hdc, uintptr(unsafe.Pointer(&lnR)), lnBrush)
		_DeleteObject.Call(lnBrush)
	}
}

// ── Instalação em goroutine ───────────────────────────────────────────────────
func runInstall(hwnd uintptr) {
	step := func(n int) {
		_PostMessageW.Call(hwnd, WM_APP_STEP, uintptr(n), 0)
	}
	status := func(s string, pct int) {
		p, _ := windows.UTF16PtrFromString(s)
		_PostMessageW.Call(hwnd, WM_APP_STATUS, 0, uintptr(unsafe.Pointer(p)))
		_PostMessageW.Call(hwnd, WM_APP_PROGRESS, uintptr(pct), 0)
	}
	fail := func(s string) {
		p, _ := windows.UTF16PtrFromString(s)
		_PostMessageW.Call(hwnd, WM_APP_ERROR, 0, uintptr(unsafe.Pointer(p)))
	}

	// Etapa 1 — parar processos
	step(1)
	status("Parando processos existentes...", 5)
	stopRustDeskProcesses()

	// Etapa 2 — instalar RustDesk
	step(2)
	if _, err := os.Stat(rustdeskExe); os.IsNotExist(err) {
		status("Baixando RustDesk...", 10)
		tmp := filepath.Join(os.TempDir(), "rustdesk-setup.exe")
		if err := downloadWithProgress(rustdeskDownload, tmp, func(pct int) {
			status(fmt.Sprintf("Baixando RustDesk...  %d%%", pct), 10+pct/3)
		}); err != nil {
			fail("Download falhou: " + err.Error())
			return
		}
		status("Instalando RustDesk...", 44)
		cmd := exec.Command(tmp, "--silent-install")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := cmd.Run(); err != nil {
			fail("Instalação falhou: " + err.Error())
			return
		}
		stopRustDeskProcesses()
	} else {
		status("RustDesk já instalado.", 44)
	}

	// Etapa 3 — configurar
	step(3)
	status("Limpando configuração antiga...", 50)
	clearRustDeskConfigDirs()

	status("Aplicando configuração do servidor...", 55)
	appData, _ := os.UserConfigDir()
	configDir := filepath.Join(appData, "RustDesk", "config")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		fail("Erro ao criar config: " + err.Error())
		return
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "rendezvous_server = '%s:21116'\n", serverIP)
	sb.WriteString("nat_type = 1\nserial = 0\n\n[options]\n")
	fmt.Fprintf(&sb, "key = '%s'\n", serverKey)
	fmt.Fprintf(&sb, "custom-rendezvous-server = '%s'\n", serverIP)
	fmt.Fprintf(&sb, "relay-server = '%s'\n", serverIP)
	effectiveAPIURL := apiURL
	if apiURL != "" && tenantID != "" {
		effectiveAPIURL = strings.TrimRight(apiURL, "/") + "/t/" + tenantID
	}
	if effectiveAPIURL != "" {
		fmt.Fprintf(&sb, "api-server = '%s'\n", effectiveAPIURL)
	}
	if unattendedPassword != "" {
		fmt.Fprintf(&sb, "permanent-password = '%s'\n", unattendedPassword)
	}

	if err := os.WriteFile(filepath.Join(configDir, "RustDesk2.toml"), []byte(sb.String()), 0644); err != nil {
		fail("Erro ao salvar config: " + err.Error())
		return
	}
	if err := applyRustDeskOptions(); err != nil {
		fail("Erro ao aplicar opções: " + err.Error())
		return
	}

	status("Propagando configuração para o serviço...", 72)
	propagateConfigToSystemProfile()

	// Etapa 4 — serviço
	step(4)
	status("Instalando agente de gerenciamento...", 78)
	if err := installAgent(); err != nil {
		fail("Erro no agente: " + err.Error())
		return
	}

	status("Ativando serviço de inicialização...", 86)
	installRustDeskService()

	if unattendedPassword != "" {
		status("Aguardando serviço inicializar...", 90)
		time.Sleep(4 * time.Second)
		status("Definindo senha de acesso remoto...", 93)
		setRustDeskPasswordWithRetry(unattendedPassword)
	}

	status("Iniciando RustDesk...", 97)
	exec.Command(rustdeskExe).Start()

	status("Instalação concluída!", 100)
	_PostMessageW.Call(hwnd, WM_APP_DONE, 0, 0)
}

// ── Helpers de opções ─────────────────────────────────────────────────────────
func applyRustDeskOptions() error {
	options := [][2]string{
		{"key", serverKey},
		{"custom-rendezvous-server", serverIP},
		{"relay-server", serverIP},
	}
	if apiURL != "" {
		effectiveAPIURL := strings.TrimRight(apiURL, "/") + "/t/" + tenantID
		options = append(options, [2]string{"api-server", effectiveAPIURL})
	}
	for _, opt := range options {
		cmd := exec.Command(rustdeskExe, "--option", opt[0], opt[1])
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %v: %s", opt[0], err, strings.TrimSpace(string(out)))
		}
	}
	return nil
}

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
	svcStop := exec.Command("sc", "stop", "RustDesk")
	svcStop.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	svcStop.Run()
	kill := exec.Command("taskkill", "/F", "/IM", "rustdesk.exe")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	kill.Run()
	time.Sleep(1500 * time.Millisecond)
}

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

func setRustDeskPasswordWithRetry(password string) {
	for i := 0; i < 6; i++ {
		cmd := exec.Command(rustdeskExe, "--password", password)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if _, err := cmd.CombinedOutput(); err == nil {
			return
		}
		time.Sleep(2 * time.Second)
	}
}

func installRustDeskService() {
	svcInstall := exec.Command(rustdeskExe, "--install-service")
	svcInstall.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	svcInstall.Run()
	scConfig := exec.Command("sc", "config", "RustDesk", "start=", "auto")
	scConfig.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	scConfig.Run()
	scStart := exec.Command("sc", "start", "RustDesk")
	scStart.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	scStart.Run()
}

func installAgent() error {
	if len(embeddedAgent) == 0 {
		return fmt.Errorf("agente não incluído no instalador")
	}
	if err := os.MkdirAll(agentDir, 0755); err != nil {
		return err
	}
	exec.Command("schtasks", "/End", "/TN", agentTask).Run()
	exec.Command("taskkill", "/F", "/IM", "rustdesk-agent.exe").Run()
	if err := os.WriteFile(agentExe, embeddedAgent, 0755); err != nil {
		return err
	}
	create := exec.Command(
		"schtasks", "/Create",
		"/TN", agentTask,
		"/TR", fmt.Sprintf(`"%s"`, agentExe),
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/F",
	)
	create.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := create.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	start := exec.Command("schtasks", "/Run", "/TN", agentTask)
	start.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	start.Run()
	return nil
}

// ── Helpers Win32 ─────────────────────────────────────────────────────────────
func createFont(size int, bold bool) uintptr {
	weight := 400
	if bold {
		weight = 600
	}
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
	info := shellExInfo{fMask: 0x00000040, lpVerb: verb, lpFile: file, nShow: SW_SHOW}
	info.cbSize = uint32(unsafe.Sizeof(info))
	_ShellExecuteW.Call(0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		0, 0, SW_SHOW,
	)
}

func downloadWithProgress(url, dest string, progress func(int)) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
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
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}
