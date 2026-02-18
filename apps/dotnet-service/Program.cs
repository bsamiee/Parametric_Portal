using System.Globalization;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;
using Serilog.Events;
using Serilog.Exceptions;
using Serilog.Sinks.OpenTelemetry;

namespace DotnetService;

internal static class Program {
    public static async Task Main(string[] args) {
        WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
        string serviceName = builder.Environment.ApplicationName;
        string serviceVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
        string deploymentEnvironment = builder.Environment.EnvironmentName;
        string otlpEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4317";
        Uri otlpUri = new(otlpEndpoint);
        _ = builder.Host.UseSerilog((_, _, loggerConfiguration) => _ = loggerConfiguration
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
            .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .Enrich.WithExceptionDetails()
            .Enrich.WithDemystifiedStackTraces()
            .WriteTo.Console(
                formatProvider: CultureInfo.InvariantCulture,
                outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext} {Message:lj}{NewLine}{Exception}")
            .WriteTo.OpenTelemetry(options => (options.Endpoint, options.Protocol, options.IncludedData, options.ResourceAttributes) = (
                otlpEndpoint,
                OtlpProtocol.Grpc,
                IncludedData.SpecRequiredResourceAttributes
                    | IncludedData.TraceIdField
                    | IncludedData.SpanIdField
                    | IncludedData.MessageTemplateTextAttribute
                    | IncludedData.MessageTemplateMD5HashAttribute,
                new Dictionary<string, object> {
                    ["service.name"] = serviceName,
                    ["service.version"] = serviceVersion,
                    ["deployment.environment"] = deploymentEnvironment
                })));
        _ = builder.Services
            .AddOpenTelemetry()
            .ConfigureResource(rb => _ = rb.AddService(
                serviceName: serviceName,
                serviceVersion: serviceVersion))
            .WithTracing(tracing => _ = tracing
                .AddAspNetCoreInstrumentation(options => options.RecordException = true)
                .AddHttpClientInstrumentation(options => options.RecordException = true)
                .AddOtlpExporter(options => options.Endpoint = otlpUri))
            .WithMetrics(metrics => _ = metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddOtlpExporter(options => options.Endpoint = otlpUri));
        WebApplication app = builder.Build();
        _ = app.UseSerilogRequestLogging();
        _ = app.MapGet("/", () => Results.Ok(new { status = "ok" }));
        await app.RunAsync().ConfigureAwait(false);
    }
}
