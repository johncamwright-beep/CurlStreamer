param(
  [Parameter(Mandatory = $true)][string]$StudioSource,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $StudioSource).Path
$evidenceRoot = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidenceRoot) { throw 'Use a new isolated evidence directory.' }
if ($evidenceRoot.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must be outside the assembly.' }
$manifest = Get-Content (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
$icons = @($manifest.files | Where-Object { $_.path -match '^icons/curlstreamer-shell-' })
if ($icons.Count -ne 1 -or $icons[0].path -notmatch '^icons/curlstreamer-shell-([a-f0-9]{64})\.ico$' -or $Matches[1] -ne $icons[0].sha256) { throw 'Expected one content-addressed shell ICO.' }
$iconPath = Join-Path $sourceRoot $icons[0].path
if ((Get-FileHash -LiteralPath $iconPath).Hash.ToLowerInvariant() -ne $icons[0].sha256) { throw 'Shell ICO differs from manifest.' }
New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StudioShellIconFixture {
 [StructLayout(LayoutKind.Sequential)] public struct Size { public int width,height; }
 [ComImport,Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface Factory { [PreserveSig] int GetImage(Size size,uint flags,out IntPtr bitmap); }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHCreateItemFromParsingName(string path,IntPtr bind,ref Guid iid,out Factory factory);
 [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr value);
 public static IntPtr Image(string path,int size) { Factory factory;Guid iid=typeof(Factory).GUID;Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path,IntPtr.Zero,ref iid,out factory));try {IntPtr bitmap;Marshal.ThrowExceptionForHR(factory.GetImage(new Size {width=size,height=size},0x104,out bitmap));return bitmap;}finally{Marshal.ReleaseComObject(factory);} }
 [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
 [StructLayout(LayoutKind.Explicit,Size=24)] public struct Value { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer; }
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Store { [PreserveSig]int GetCount(out uint count);[PreserveSig]int GetAt(uint index,out Key key);[PreserveSig]int GetValue(ref Key key,out Value value);[PreserveSig]int SetValue(ref Key key,ref Value value);[PreserveSig]int Commit(); }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path,IntPtr bind,uint flags,ref Guid iid,out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
 public static void AppId(string path) {Store store;Guid iid=typeof(Store).GUID;Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path,IntPtr.Zero,2,ref iid,out store));var key=new Key{format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=5};var value=new Value{type=31,pointer=Marshal.StringToCoTaskMemUni("CurlStreamer.Studio")};try{Marshal.ThrowExceptionForHR(store.SetValue(ref key,ref value));Marshal.ThrowExceptionForHR(store.Commit());}finally{Marshal.FreeCoTaskMem(value.pointer);Marshal.ReleaseComObject(store);} }
 public static string ReadAppId(string path) {Store store;Guid iid=typeof(Store).GUID;Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path,IntPtr.Zero,0,ref iid,out store));var key=new Key{format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=5};Value value;try{Marshal.ThrowExceptionForHR(store.GetValue(ref key,out value));try{return value.type==31?Marshal.PtrToStringUni(value.pointer):null;}finally{PropVariantClear(ref value);}}finally{Marshal.ReleaseComObject(store);} }
}
'@
$linkPath = Join-Path $evidenceRoot 'CurlStreamer Studio fixture.lnk'
$wsh = New-Object -ComObject WScript.Shell
try {
  $link = $wsh.CreateShortcut($linkPath)
  $link.TargetPath = Join-Path $sourceRoot 'CurlStreamer Studio.exe'
  $link.WorkingDirectory = $sourceRoot
  $link.IconLocation = $iconPath + ',0'
  $link.Save()
  [StudioShellIconFixture]::AppId($linkPath)
  $verifiedLink = $wsh.CreateShortcut($linkPath)
  if ($verifiedLink.TargetPath -ne (Join-Path $sourceRoot 'CurlStreamer Studio.exe') -or $verifiedLink.IconLocation -ne ($iconPath+',0')) { throw 'Persisted shortcut target or standalone ICO reference differs.' }
  $appId = [StudioShellIconFixture]::ReadAppId($linkPath)
  if ($appId -ne 'CurlStreamer.Studio') { throw 'Fixture shortcut lost its application identity.' }
  $images = @()
  foreach ($size in @(16,32,96,256)) {
    $hashes = @()
    foreach ($item in @(@{name='ico';path=$iconPath},@{name='shortcut';path=$linkPath})) {
      $handle = [StudioShellIconFixture]::Image($item.path,$size)
      try {
        $bitmap = [Drawing.Image]::FromHbitmap($handle)
        try {
          if ($bitmap.Width -ne $size -or $bitmap.Height -ne $size) { throw 'Shell image factory returned the wrong dimensions.' }
          $output = Join-Path $evidenceRoot ($item.name+'-'+$size+'.png')
          $bitmap.Save($output,[Drawing.Imaging.ImageFormat]::Png)
          $hash = (Get-FileHash $output).Hash.ToLowerInvariant()
          $hashes += $hash
          $images += [ordered]@{kind=$item.name;requestedSize=$size;width=$bitmap.Width;height=$bitmap.Height;pngSha256=$hash;path=$output}
        } finally { $bitmap.Dispose() }
      } finally { [void][StudioShellIconFixture]::DeleteObject($handle) }
    }
    if ($hashes[0] -ne $hashes[1]) { throw "Shortcut shell image differs from ICO at $size pixels." }
  }
  [ordered]@{iconPath=$icons[0].path;iconSha256=$icons[0].sha256;shortcutTarget=$link.TargetPath;shortcutIcon=$link.IconLocation;appId=$appId;images=$images;appLaunched=$false;installerRun=$false;userShortcutsModified=$false} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidenceRoot 'evidence.json') -Encoding utf8NoBOM
  Write-Output 'PASS: manifest ICO hash and isolated shortcut shell images match at 16/32/96/256px; application identity retained; no app/installer launch.'
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) }
