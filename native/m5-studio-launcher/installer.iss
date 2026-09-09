; Compile with Inno Setup 6 after the release notices and clean-machine checks pass.
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
function InitializeUninstall(): Boolean;
begin
  Result := not CheckForMutexes('Local\CurlStreamerStudio');
  if not Result then MsgBox('Finish and close Studio before uninstalling. Your recordings will be kept.', mbInformation, MB_OK);
end;
