#define MyAppName "Child Monitor Agent"
#define MyAppPublisher "Laptop Monitoring Project"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.9"
#endif
#ifndef ReleaseRoot
  #define ReleaseRoot "release\ChildMonitorAgent"
#endif
#ifndef OutputRoot
  #define OutputRoot "output"
#endif
#ifndef DefaultServerUrl
  #define DefaultServerUrl "https://api.tuansosad.id.vn"
#endif

[Setup]
AppId={{A3276A0B-0542-4F8C-83B4-B5C197C9D188}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ChildMonitorAgent
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputRoot}
OutputBaseFilename=ChildMonitorSetup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Child Monitor Agent Installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Files]
Source: "{#ReleaseRoot}\service\*"; DestDir: "{app}\service"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ReleaseRoot}\companion\*"; DestDir: "{app}\companion"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ReleaseRoot}\installer\*"; DestDir: "{app}\installer"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ReleaseRoot}\models\*"; DestDir: "{app}\models"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\config"
Name: "{app}\db"
Name: "{app}\logs"
Name: "{app}\temp"

[Run]
Filename: "{app}\installer\ChildMonitorProvision.exe"; Parameters: "{code:GetProvisionArguments}"; StatusMsg: "Đang xác thực và lưu cấu hình Agent..."; Flags: runhidden waituntilterminated
Filename: "{app}\service\ChildMonitorService.exe"; Parameters: "--startup auto install"; StatusMsg: "Đang cài Windows Service..."; Flags: runhidden waituntilterminated
Filename: "{app}\service\ChildMonitorService.exe"; Parameters: "--wait=30 start"; StatusMsg: "Đang khởi động Agent..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\service\ChildMonitorService.exe"; Parameters: "--wait=30 stop"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopService"
Filename: "{sys}\taskkill.exe"; Parameters: "/IM ChildMonitorCompanion.exe /T /F"; Flags: runhidden waituntilterminated; RunOnceId: "StopCompanion"
Filename: "{app}\service\ChildMonitorService.exe"; Parameters: "remove"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "RemoveService"

[Code]
var
  AgentConfigPage: TInputQueryWizardPage;
  SecretFilePath: String;
  PurgeLocalData: Boolean;

function IsSafeSubjectId(const Value: String): Boolean;
var
  Index: Integer;
  Current: Char;
begin
  Result := False;
  if (Value = '') then
  begin
    Result := True;
    Exit;
  end;
  if (Length(Value) <= 8) or (Copy(Value, 1, 8) <> 'subject-') then
    Exit;
  for Index := 9 to Length(Value) do
  begin
    Current := Value[Index];
    if not (((Current >= 'A') and (Current <= 'Z')) or
            ((Current >= 'a') and (Current <= 'z')) or
            ((Current >= '0') and (Current <= '9')) or
            (Current = '_') or (Current = '-')) then
      Exit;
  end;
  Result := True;
end;

function ValidateAgentConfig: String;
begin
  Result := '';
  if Trim(AgentConfigPage.Values[0]) = '' then
    Result := 'Bạn phải nhập Backend URL.'
  else if Pos('"', AgentConfigPage.Values[0]) > 0 then
    Result := 'Backend URL chứa ký tự không hợp lệ.'
  else if Trim(AgentConfigPage.Values[1]) = '' then
    Result := 'Bạn phải nhập Device Secret.'
  else if Pos('"', AgentConfigPage.Values[1]) > 0 then
    Result := 'Device Secret chứa ký tự không hợp lệ.'
  else if not IsSafeSubjectId(Trim(AgentConfigPage.Values[2])) then
    Result := 'Subject ID phải có dạng subject-<mã-an-toàn>.';
end;

procedure InitializeWizard;
begin
  AgentConfigPage := CreateInputQueryPage(
    wpSelectDir,
    'Kết nối Agent với hệ thống',
    'Nhập thông tin thiết bị đã đăng ký trên Parent Dashboard.',
    'Setup sẽ kiểm tra Device Secret với Backend trước khi cài Service.'
  );
  AgentConfigPage.Add('Backend URL:', False);
  AgentConfigPage.Add('Device Secret:', True);
  AgentConfigPage.Add('Subject ID (không bắt buộc):', False);
  AgentConfigPage.Values[0] := ExpandConstant(
    '{param:SERVERURL|{#DefaultServerUrl}}'
  );
  AgentConfigPage.Values[1] := ExpandConstant('{param:DEVICESECRET|}');
  AgentConfigPage.Values[2] := ExpandConstant('{param:SUBJECTID|}');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ValidationError: String;
begin
  Result := True;
  if CurPageID = AgentConfigPage.ID then
  begin
    ValidationError := ValidateAgentConfig;
    if ValidationError <> '' then
    begin
      MsgBox(ValidationError, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := ValidateAgentConfig;
  if Result <> '' then
    Exit;

  { Stop an existing source or packaged installation before replacing files. }
  Exec(
    ExpandConstant('{sys}\sc.exe'),
    'stop ChildMonitorService',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );
  Sleep(2000);
  Exec(
    ExpandConstant('{sys}\taskkill.exe'),
    '/IM ChildMonitorCompanion.exe /T /F',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    SecretFilePath := ExpandConstant('{tmp}\child-monitor-device-secret.tmp');
    if not SaveStringToFile(
      SecretFilePath,
      Trim(AgentConfigPage.Values[1]) + #13#10,
      False
    ) then
      RaiseException('Không thể tạo tệp Device Secret tạm thời.');
  end;
end;

function GetProvisionArguments(Param: String): String;
var
  SubjectId: String;
begin
  Result := '--server-url "' + Trim(AgentConfigPage.Values[0]) +
    '" --device-secret-file "' + SecretFilePath +
    '" --delete-secret-file --config-path "' +
    ExpandConstant('{app}\config\local_config.json') + '"';
  SubjectId := Trim(AgentConfigPage.Values[2]);
  if SubjectId <> '' then
    Result := Result + ' --vision-subject-id "' + SubjectId + '"';
end;

procedure DeinitializeSetup;
begin
  if (SecretFilePath <> '') and FileExists(SecretFilePath) then
    DeleteFile(SecretFilePath);
end;

function InitializeUninstall: Boolean;
begin
  Result := True;
  PurgeLocalData := False;
  if not UninstallSilent then
    PurgeLocalData := MsgBox(
      'Bạn có muốn xóa vĩnh viễn cấu hình, hàng đợi offline và logs cục bộ không?' + #13#10 + #13#10 +
      'Chọn No để giữ dữ liệu cho lần cài lại sau.',
      mbConfirmation,
      MB_YESNO
    ) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and PurgeLocalData then
    DelTree(ExpandConstant('{app}'), True, True, True);
end;
