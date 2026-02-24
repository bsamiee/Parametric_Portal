using System;
using System.IO;
using System.Text.Json;
namespace ParametricPortal.Kargadan.Plugin.src.transport;

internal static class WebSocketPortFile {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
    private static readonly string PortFilePath =
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".kargadan",
            "port");
    private static readonly string PortFileTempPath = PortFilePath + ".tmp";
    internal static void Write(int port) {
        string directory = Path.GetDirectoryName(PortFilePath)!;
        _ = Directory.CreateDirectory(directory);
        PortFilePayload payload = new(
            Port: port,
            Pid: Environment.ProcessId,
            StartedAt: DateTimeOffset.UtcNow);
        string json = JsonSerializer.Serialize(
            value: payload,
            options: JsonOptions);
        File.WriteAllText(
            path: PortFileTempPath,
            contents: json);
        File.Move(
            sourceFileName: PortFileTempPath,
            destFileName: PortFilePath,
            overwrite: true);
    }
    internal static void Delete() {
        try {
            File.Delete(PortFilePath);
        } catch (IOException) {
            // why: best-effort cleanup on shutdown
        } catch (UnauthorizedAccessException) {
            // why: best-effort cleanup on shutdown
        }
    }
    private sealed record PortFilePayload(int Port, int Pid, DateTimeOffset StartedAt);
}
