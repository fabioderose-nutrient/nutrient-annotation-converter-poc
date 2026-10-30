using System.IO;
using GdPicture14.WEB;
using Microsoft.AspNetCore.Mvc;
using AnnotationConverterApi.Models;

namespace AnnotationConverterApi.Controllers
{
    [ApiController]
    [Route("api/DocuVieware")]
    public class DocuViewareController : ControllerBase
    {
        [HttpPost]
        [Route("GetDocuViewareControl")]
        public DocuViewareRESTOutputResponse GetDocuViewareControl(DocuViewareConfiguration controlConfiguration)
        {
            if (!DocuViewareManager.IsSessionAlive(controlConfiguration.SessionId))
            {
                if (!string.IsNullOrEmpty(controlConfiguration.SessionId) &&
                    !string.IsNullOrEmpty(controlConfiguration.ControlId))
                {
                    DocuViewareManager.CreateDocuViewareSession(
                        controlConfiguration.SessionId,
                        controlConfiguration.ControlId,
                        20);
                }
                else
                {
                    throw new Exception("Invalid session identifier and/or invalid control identifier.");
                }
            }

            using (var docuVieware = new DocuViewareControl(controlConfiguration.SessionId))
            {
                docuVieware.AllowPrint = controlConfiguration.AllowPrint;
                docuVieware.EnablePrintButton = controlConfiguration.EnablePrintButton;
                docuVieware.AllowUpload = controlConfiguration.AllowUpload;
                docuVieware.EnableFileUploadButton = controlConfiguration.EnableFileUploadButton;
                docuVieware.CollapsedSnapIn = controlConfiguration.CollapsedSnapIn;
                docuVieware.ShowAnnotationsSnapIn = controlConfiguration.ShowAnnotationsSnapIn;
                docuVieware.EnableRotateButtons = controlConfiguration.EnableRotateButtons;
                docuVieware.EnableZoomButtons = controlConfiguration.EnableZoomButtons;
                docuVieware.EnablePageViewButtons = controlConfiguration.EnablePageViewButtons;
                docuVieware.EnableMultipleThumbnailSelection = controlConfiguration.EnableMultipleThumbnailSelection;
                docuVieware.EnableMouseModeButtons = controlConfiguration.EnableMouseModeButtons;
                docuVieware.EnableFormFieldsEdition = controlConfiguration.EnableFormFieldsEdition;
                docuVieware.EnableTwainAcquisitionButton = controlConfiguration.EnableTwainAcquisitionButton;
                docuVieware.MaxUploadSize = 36700160;
                docuVieware.EnableAnnotationActionButtons = controlConfiguration.EnableAnnotationActionButtons;

                if (string.Equals(controlConfiguration.Theme, "dark", StringComparison.OrdinalIgnoreCase))
                {
                    docuVieware.UserInterfaceTheme = UserInterfaceTheme.Dark;
                }
                else
                {
                    docuVieware.UserInterfaceTheme = UserInterfaceTheme.Light;
                }

                using (var controlOutput = new StringWriter())
                {
                    docuVieware.RenderControl(controlOutput);
                    return new DocuViewareRESTOutputResponse
                    {
                        HtmlContent = controlOutput.ToString()
                    };
                }
            }
        }
    }
}
