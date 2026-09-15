; RustDesk Plus — instalador cliente (InnoSetup).
; Compilado por tenant pelo plus-api via ISCC, com os valores abaixo injetados
; por /D na linha de comando (ver plus-api/src/installer.rs). NÃO defina valores
; fixos aqui além dos defaults vazios usados quando o script é aberto direto no
; IDE do Inno Setup para edição/teste de sintaxe.

#ifndef ServerIP
  #define ServerIP ""
#endif
#ifndef ServerKey
  #define ServerKey ""
#endif
#ifndef ApiUrl
  #define ApiUrl ""
#endif
#ifndef TenantID
  #define TenantID ""
#endif
#ifndef InstallCode
  #define InstallCode ""
#endif
#ifndef UnattendedPassword
  #define UnattendedPassword ""
#endif
#ifndef AgentEnabled
  #define AgentEnabled "false"
#endif
#ifndef RustdeskSetupPath
  #define RustdeskSetupPath "rustdesk-setup.exe"
#endif
#ifndef VCRedistPath
  #define VCRedistPath "vc_redist.x64.exe"
#endif
#ifndef AgentExePath
  #define AgentExePath "rustdesk-agent.exe"
#endif

[Setup]
AppId={{7C1B9C2E-4B6C-4E2A-9F3D-RDPLUSCLIENT}}
AppName=RustDesk Plus
AppVersion=1.0
AppPublisher=RustDesk Plus
DefaultDirName={autopf}\RustDesk Plus Installer
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=.
OutputBaseFilename=rustdesk-installer
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
AppMutex=RustDeskPlusInstallerMutex
Uninstallable=no
SetupLogging=yes
; Sem tela de licença/opções: a única decisão do usuário é clicar em instalar.
DisableWelcomePage=no

[Files]
Source: "{#RustdeskSetupPath}"; DestDir: "{tmp}"; DestName: "rustdesk-setup.exe"; Flags: dontcopy ignoreversion
Source: "{#VCRedistPath}"; DestDir: "{tmp}"; DestName: "vc_redist.x64.exe"; Flags: dontcopy ignoreversion
#if AgentEnabled == "true"
Source: "{#AgentExePath}"; DestDir: "{tmp}"; DestName: "rustdesk-agent.exe"; Flags: dontcopy ignoreversion
#endif

[Code]
var
  ProgressPage: TOutputProgressWizardPage;
  InstalledExePath: string;

const
  CfgServerIP = '{#ServerIP}';
  CfgServerKey = '{#ServerKey}';
  CfgApiUrl = '{#ApiUrl}';
  CfgTenantID = '{#TenantID}';
  CfgInstallCode = '{#InstallCode}';
  CfgPassword = '{#UnattendedPassword}';
  CfgAgentEnabled = '{#AgentEnabled}';

// ── Validação ────────────────────────────────────────────────────────────────
function InitializeSetup(): Boolean;
begin
  Result := True;
  if (CfgServerIP = '') or (CfgTenantID = '') then
  begin
    MsgBox('Este instalador não foi configurado corretamente.' + #13#10 + #13#10 +
      'Baixe o instalador pelo painel de gerenciamento.', mbCriticalError, MB_OK);
    Result := False;
  end;
end;

// ── Helpers de processo ───────────────────────────────────────────────────────
procedure KillProcess(const ExeName: string);
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM "' + ExeName + '"', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// O cliente com marca tem o executável renomeado (não "rustdesk.exe"), então
// mata qualquer .exe da pasta de instalação — senão o processo antigo segura
// os arquivos e o --silent-install trava.
procedure StopRustDeskProcesses();
var
  FindRec: TFindRec;
  Dir: string;
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop RustDesk', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  KillProcess('rustdesk.exe');
  KillProcess('RustDesk.exe');
  Dir := ExpandConstant('{pf64}\RustDesk');
  if DirExists(Dir) and FindFirst(Dir + '\*.exe', FindRec) then
  begin
    try
      repeat
        KillProcess(FindRec.Name);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  Sleep(1500);
end;

// ── Localizar o executável instalado ──────────────────────────────────────────
function LargestExeIn(const Dir: string): string;
var
  FindRec: TFindRec;
  BestSize: Int64;
  LowerName: string;
begin
  Result := '';
  BestSize := 0;
  if not DirExists(Dir) then Exit;
  if FindFirst(Dir + '\*.exe', FindRec) then
  begin
    try
      repeat
        LowerName := Lowercase(FindRec.Name);
        if (Pos('runtimebroker', LowerName) > 0) or (Pos('deviceinstaller', LowerName) > 0)
          or (Pos('usbmmidd', LowerName) > 0) then
          Continue;
        if (FindRec.SizeHigh = 0) and (Int64(FindRec.SizeLow) > BestSize) then
        begin
          BestSize := FindRec.SizeLow;
          Result := Dir + '\' + FindRec.Name;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

// O --silent-install do RustDesk se relança elevado e retorna antes de copiar
// os arquivos — em máquinas que nunca tiveram o RustDesk, sem essa espera o
// instalador seguia com o caminho antigo (inexistente) e falhava com
// "o sistema não pode encontrar o caminho especificado". Faz polling em vez de
// checar uma única vez.
function WaitForInstalledExe(): string;
var
  Candidate: string;
  Attempts: Integer;
begin
  Result := '';
  for Attempts := 1 to 60 do
  begin
    Candidate := ExpandConstant('{pf64}\RustDesk\RustDesk.exe');
    if FileExists(Candidate) then begin Result := Candidate; Exit; end;
    Candidate := LargestExeIn(ExpandConstant('{pf64}\RustDesk'));
    if Candidate <> '' then begin Result := Candidate; Exit; end;
    Sleep(1500);
  end;
end;

// O RustDesk registra o serviço e chama helpers pelo nome fixo "RustDesk.exe".
// O cliente com marca renomeia o executável, então sem esta cópia o serviço
// aponta para um arquivo inexistente e não sobe.
procedure EnsureCanonicalExe(const ExePath: string);
var
  Canonical: string;
begin
  if ExePath = '' then Exit;
  if Lowercase(ExtractFileName(ExePath)) = 'rustdesk.exe' then Exit;
  Canonical := ExtractFilePath(ExePath) + 'RustDesk.exe';
  FileCopy(ExePath, Canonical, False);
end;

// ── VC++ Redistributable ───────────────────────────────────────────────────────
// O cliente Flutter depende do runtime VC++; sem ele o executável instalado
// falha com 0xc0000135 (DLL não encontrada). Empacotado no instalador (em vez
// de baixado em tempo de instalação) para funcionar mesmo sem acesso à
// internet no PC de destino e para reduzir o padrão "baixa e executa" que
// antivírus heurísticos costumam sinalizar.
function VCRedistInstalled(): Boolean;
begin
  Result := FileExists(ExpandConstant('{sys}\vcruntime140.dll'))
    and FileExists(ExpandConstant('{sys}\msvcp140.dll'));
end;

procedure InstallVCRedist();
var
  ResultCode: Integer;
begin
  if VCRedistInstalled() then Exit;
  ExtractTemporaryFile('vc_redist.x64.exe');
  Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), '/install /quiet /norestart', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ── Configuração do servidor ───────────────────────────────────────────────────
function BuildTomlConfig(): string;
var
  S, ApiFull: string;
begin
  S := 'rendezvous_server = ''' + CfgServerIP + ':21116''' + #13#10;
  S := S + 'nat_type = 1' + #13#10 + 'serial = 0' + #13#10 + #13#10 + '[options]' + #13#10;
  S := S + 'key = ''' + CfgServerKey + '''' + #13#10;
  S := S + 'custom-rendezvous-server = ''' + CfgServerIP + '''' + #13#10;
  S := S + 'relay-server = ''' + CfgServerIP + '''' + #13#10;
  if CfgApiUrl <> '' then
  begin
    ApiFull := CfgApiUrl;
    if (Length(ApiFull) > 0) and (ApiFull[Length(ApiFull)] = '/') then
      Delete(ApiFull, Length(ApiFull), 1);
    if CfgTenantID <> '' then
      ApiFull := ApiFull + '/t/' + CfgTenantID;
    S := S + 'api-server = ''' + ApiFull + '''' + #13#10;
  end;
  if CfgPassword <> '' then
    S := S + 'permanent-password = ''' + CfgPassword + '''' + #13#10;
  Result := S;
end;

// Grava a MESMA config nos dois lugares que o RustDesk lê (perfil do usuário
// que roda o instalador elevado, e o systemprofile usado pelo serviço).
// A versão antiga também chamava "rustdesk.exe --option ..." depois de gravar
// o TOML, e essa chamada por IPC concorria com o próprio arquivo — era a causa
// mais provável de "às vezes não preenche os dados do servidor". Agora só o
// arquivo é a fonte de verdade.
procedure WriteConfigEverywhere(const Content: string);
var
  Dirs: TArrayOfString;
  I: Integer;
  UserDir: string;
begin
  UserDir := ExpandConstant('{userappdata}\RustDesk\config');
  DelTree(UserDir, True, True, True);
  ForceDirectories(UserDir);
  SaveStringToFile(UserDir + '\RustDesk2.toml', Content, False);

  SetArrayLength(Dirs, 2);
  Dirs[0] := 'C:\Windows\System32\config\systemprofile\AppData\Roaming\RustDesk\config';
  Dirs[1] := 'C:\Windows\SysWOW64\config\systemprofile\AppData\Roaming\RustDesk\config';
  for I := 0 to GetArrayLength(Dirs) - 1 do
  begin
    DelTree(Dirs[I], True, True, True);
    ForceDirectories(Dirs[I]);
    SaveStringToFile(Dirs[I] + '\RustDesk2.toml', Content, False);
  end;
end;

// A senha é definida pelo próprio cliente via a flag oficial, DEPOIS do
// arquivo de config já estar no lugar — é o formato interno que o cliente
// aceita (gravar a senha "na mão" no TOML resulta em "senha incorreta").
procedure SetPasswordWithRetry(const ExePath, Password: string);
var
  I, ResultCode: Integer;
begin
  if (Password = '') or (ExePath = '') then Exit;
  for I := 1 to 6 do
  begin
    Exec(ExePath, '--password "' + Password + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode = 0 then Exit;
    Sleep(2000);
  end;
end;

procedure InstallRustDeskService(const ExePath: string);
var
  ResultCode: Integer;
begin
  Exec(ExePath, '--install-service', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\sc.exe'), 'config RustDesk start= auto', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\sc.exe'), 'start RustDesk', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Reinicia o serviço para garantir que ele releia a config final (servidor,
// key, api-server e senha) gravada durante a instalação.
procedure RestartRustDeskService();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop RustDesk', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(3000);
  Exec(ExpandConstant('{sys}\sc.exe'), 'start RustDesk', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure InstallAgent();
var
  AgentDir, AgentExe, Params: string;
  Q: string;
  ResultCode: Integer;
begin
  if CfgAgentEnabled <> 'true' then Exit;
  AgentDir := ExpandConstant('{pf64}\RustDesk Plus');
  ForceDirectories(AgentDir);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN RustDeskPlusAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  KillProcess('rustdesk-agent.exe');
  ExtractTemporaryFile('rustdesk-agent.exe');
  AgentExe := AgentDir + '\rustdesk-agent.exe';
  FileCopy(ExpandConstant('{tmp}\rustdesk-agent.exe'), AgentExe, False);

  Q := Chr(34);
  Params := '/Create /TN RustDeskPlusAgent /TR ' + Q + Q + AgentExe + Q + Q +
    ' /SC ONSTART /RU SYSTEM /RL HIGHEST /F';
  Exec(ExpandConstant('{sys}\schtasks.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Run /TN RustDeskPlusAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Tenta baixar o cliente com marca do tenant (se configurado). Usa a função
// nativa de download do Inno Setup (6.3+) em vez de código Win32 solto — é o
// mesmo mecanismo usado por instaladores legítimos consagrados (ex.: runtimes
// da Microsoft), o que pesa a favor na heurística de vários antivírus.
function OnBrandedProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

function TryDownloadBranded(): string;
var
  Url: string;
  Size: Int64;
begin
  Result := '';
  if (CfgApiUrl = '') or (CfgInstallCode = '') then Exit;
  Url := CfgApiUrl;
  if (Length(Url) > 0) and (Url[Length(Url)] = '/') then
    Delete(Url, Length(Url), 1);
  Url := Url + '/api/branded/' + CfgInstallCode;
  try
    Size := DownloadTemporaryFile(Url, 'branded-setup.exe', '', @OnBrandedProgress);
    if Size > 1024 * 1024 then
      Result := ExpandConstant('{tmp}\branded-setup.exe');
  except
    Result := '';
  end;
end;

// ── Orquestração principal ─────────────────────────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
var
  SetupExe, BrandedPath: string;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  ProgressPage := CreateOutputProgressPage('Instalando RustDesk Plus', 'Aguarde enquanto configuramos o acesso remoto.');
  ProgressPage.Show;
  try
    ProgressPage.SetText('Parando processos existentes...', '');
    StopRustDeskProcesses();

    ProgressPage.SetText('Preparando cliente RustDesk...', '');
    BrandedPath := TryDownloadBranded();
    if BrandedPath <> '' then
      SetupExe := BrandedPath
    else
    begin
      ExtractTemporaryFile('rustdesk-setup.exe');
      SetupExe := ExpandConstant('{tmp}\rustdesk-setup.exe');
    end;

    ProgressPage.SetText('Instalando RustDesk...', '');
    Exec(SetupExe, '--silent-install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    StopRustDeskProcesses();

    ProgressPage.SetText('Aguardando instalação finalizar...', '');
    InstalledExePath := WaitForInstalledExe();
    if InstalledExePath = '' then
    begin
      MsgBox('O RustDesk não foi encontrado após a instalação.' + #13#10 + #13#10 +
        'Verifique se o antivírus não bloqueou o instalador e tente novamente.',
        mbCriticalError, MB_OK);
      Exit;
    end;
    EnsureCanonicalExe(InstalledExePath);

    ProgressPage.SetText('Verificando componentes do Windows...', '');
    InstallVCRedist();

    ProgressPage.SetText('Aplicando configuração do servidor...', '');
    WriteConfigEverywhere(BuildTomlConfig());

    if CfgPassword <> '' then
    begin
      ProgressPage.SetText('Definindo senha de acesso remoto...', '');
      SetPasswordWithRetry(InstalledExePath, CfgPassword);
    end;

    ProgressPage.SetText('Instalando serviço do Windows...', '');
    InstallRustDeskService(InstalledExePath);

    if CfgAgentEnabled = 'true' then
    begin
      ProgressPage.SetText('Instalando agente de gerenciamento...', '');
      InstallAgent();
    end;

    ProgressPage.SetText('Reiniciando serviço...', '');
    RestartRustDeskService();

    ProgressPage.SetText('Iniciando RustDesk...', '');
    Exec(InstalledExePath, '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
  finally
    ProgressPage.Hide;
  end;
end;
