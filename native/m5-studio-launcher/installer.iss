; Private preview compiler: scripts/build-m5-installer.ps1 (Inno Setup 6.7.3).
; Required: /DStudioSource=... /DStudioVersion=... /DInstallerOutput=...
#ifndef StudioSource
  #error StudioSource is required
#endif
#ifndef StudioVersion
  #error StudioVersion is required
#endif
#ifndef InstallerOutput
  #error InstallerOutput is required
#endif
[Setup]
AppId={{C13ED906-44B5-493A-AF70-81BE409EF911}
AppName=CurlStreamer Studio
AppVersion={#StudioVersion}
DefaultDirName={localappdata}\Programs\CurlStreamer Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#InstallerOutput}
OutputBaseFilename=CurlStreamer-Studio-{#StudioVersion}-Setup
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\CurlStreamer Studio.exe
AppMutex=Local\CurlStreamerStudio
[Files]
Source: "{#StudioSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{userprograms}\CurlStreamer Studio"; Filename: "{app}\CurlStreamer Studio.exe"
[Code]
function InitializeSetup(): Boolean;
begin
  Result := IsDotNetInstalled(net48, 0);
  if not Result then SuppressibleMsgBox('CurlStreamer Studio needs Microsoft .NET Framework 4.8 or later. Install it, then run Setup again.', mbCriticalError, MB_OK, IDOK);
end;

function InitializeUninstall(): Boolean;
begin
  Result := not CheckForMutexes('Local\CurlStreamerStudio');
  if not Result then SuppressibleMsgBox('Finish and close Studio before uninstalling. Your recordings will be kept.', mbInformation, MB_OK, IDOK);
end;
