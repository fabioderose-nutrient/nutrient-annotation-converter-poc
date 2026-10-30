using GdPicture14;
using GdPicture14.WEB;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using AnnotationConverterApi.CustomActions;

namespace AnnotationConverterApi
{
    public class Startup
    {
        /// <summary>
        /// Public base URL of the app (APP_URI, default http://localhost:5050). DocuVieware
        /// embeds it in the control markup, so the browser must be able to reach it.
        /// </summary>
        public static string AppUri =>
            Environment.GetEnvironmentVariable("APP_URI") is { Length: > 0 } uri ? uri.TrimEnd('/') : "http://localhost:5050";

        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;

            // License key from DOCUVIEWARE_LICENSE_KEY. An empty key starts evaluation mode
            // (RegisterKEY must still be called). It also unlocks the GdPicture classes used
            // by the custom actions.
            DocuViewareLicensing.RegisterKEY(Environment.GetEnvironmentVariable("DOCUVIEWARE_LICENSE_KEY") ?? "");

            var cachePath = Path.Combine(Directory.GetCurrentDirectory(), "Cache");
            Directory.CreateDirectory(cachePath);
            DocuViewareManager.SetupConfiguration(
                true,
                DocuViewareSessionStateMode.File,
                cachePath,
                AppUri,
                "api/docuvieware3");

            DocuViewareEventsHandler.CustomAction += OnCustomAction;
        }

        public IConfiguration Configuration { get; }

        public void ConfigureServices(IServiceCollection services)
        {
            services.AddCors();
            services.AddControllers();
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }

            app.UseCors(options => options
                .AllowAnyOrigin()
                .AllowAnyMethod()
                .AllowAnyHeader());

            app.UseDefaultFiles();
            app.UseStaticFiles();

            app.UseRouting();
            app.UseWebSockets();
            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
                endpoints.MapGet("/health", async context =>
                {
                    await context.Response.WriteAsJsonAsync(new { status = "ok" });
                });
                // Nutrient Web SDK license key for the page (empty = evaluation mode).
                endpoints.MapGet("/api/config", async context =>
                {
                    await context.Response.WriteAsJsonAsync(new
                    {
                        webSdkLicenseKey = Environment.GetEnvironmentVariable("NUTRIENT_WEB_LICENSE_KEY") ?? ""
                    });
                });
            });
        }

        private static void OnCustomAction(object? sender, CustomActionEventArgs e)
        {
            if (e.actionName == "export-annotations" ||
                e.actionName == "import-annotations" ||
                e.actionName == "clear-annotations")
            {
                AnnotationConverterCustomActions.Handle(sender, e);
            }
        }
    }
}
