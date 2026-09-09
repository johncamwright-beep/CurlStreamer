using System;
using System.IO;
using System.Text.RegularExpressions;

internal static class WorkspacePolicy
{
    internal static bool SameOrigin(string value, string origin)
    {
        Uri url;
        return Uri.TryCreate(value, UriKind.Absolute, out url) && url.Scheme == "https" &&
            url.UserInfo.Length == 0 && url.GetLeftPart(UriPartial.Authority) == origin;
    }
    internal static string Game(string value, string origin)
    {
        if (!SameOrigin(value, origin)) return null;
        var match = Regex.Match(new Uri(value).AbsolutePath, @"^/(?:games|score)/([a-fA-F0-9-]{36})(?:/(?:studio|edit))?/?$");
        Guid id;
        return match.Success && Guid.TryParse(match.Groups[1].Value, out id) ? id.ToString() : null;
    }
    internal static string Code(string source, string origin, string gameId)
    {
        if (!SameOrigin(source, origin)) throw new InvalidDataException();
        var url = new Uri(source);
        if (url.AbsolutePath != "/studio-m3/" + gameId + "/program" || url.Query.Length != 0 ||
            !Regex.IsMatch(url.Fragment, @"^#code=[A-Za-z0-9_-]{43}$")) throw new InvalidDataException();
        return url.Fragment.Substring(6);
    }
    internal static bool Loopback(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && uri.Scheme == "http" &&
            uri.Host == "127.0.0.1" && uri.Port > 0 && uri.Port <= 65535 &&
            uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0;
    }
}
