using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Collections;
using System.Collections.Generic;
using GdPicture14;
using GdPicture14.Annotations;
using GdPicture14.Imaging;

namespace AnnotationConverterApi.CustomActions
{
    /// <summary>
    /// Handles annotation export/import for the Annotation Converter sample.
    /// Supports: Rectangle, Ellipse, Line, LineArrow, Polygon, ConnectedLines,
    ///           FreeHand, Text, StickyNote.
    /// Coordinates in inches (GdPicture native). Frontend handles inches↔points.
    /// </summary>
    public static class AnnotationConverterCustomActions
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static void Handle(object? sender, GdPicture14.WEB.CustomActionEventArgs e)
        {
            switch (e.actionName)
            {
                case "export-annotations": ExportAnnotations(e); break;
                case "import-annotations": ImportAnnotations(e); break;
                case "clear-annotations": ClearAnnotations(e); break;
            }
        }

        private static AnnotationManager? InitAnnotationManager(GdPicture14.WEB.CustomActionEventArgs e)
        {
            var am = new AnnotationManager();
            GdPicturePDF? pdf;
            if (e.docuVieware.GetNativePDF(out pdf) == GdPictureStatus.OK && pdf != null)
            { am.InitFromGdPicturePDF(pdf); return am; }
            int imageId;
            if (e.docuVieware.GetNativeImage(out imageId) == GdPictureStatus.OK && imageId != 0)
            { am.InitFromGdPictureImage(imageId); return am; }
            am.Close(); return null;
        }

        // =====================================================================
        //  EXPORT: Read all annotations → manual XML building
        // =====================================================================
        private static void ExportAnnotations(GdPicture14.WEB.CustomActionEventArgs e)
        {
            try
            {
                var am = InitAnnotationManager(e);
                if (am == null) { e.result = JsonErr("Could not access document"); return; }

                var sb = new StringBuilder();
                sb.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
                sb.AppendLine("<GdPicture_Annotations Version=\"1.0\">");

                try
                {
                    for (int page = 1; page <= am.PageCount; page++)
                    {
                        am.SelectPage(page);
                        int count = am.GetAnnotationCount();
                        if (count <= 0) continue;

                        sb.AppendLine($"  <Page Index=\"{page - 1}\">");

                        for (int i = 0; i < count; i++)
                        {
                            var annot = am.GetAnnotationFromIdx(i);
                            var annotType = am.GetAnnotationType(i);

                            Console.WriteLine($"[AnnotConverter] Annotation {i} on page {page}: Type={annotType}");

                            if (annot != null) ExportOneAnnotation(sb, annot, annotType);
                        }

                        sb.AppendLine("  </Page>");
                    }

                    sb.AppendLine("</GdPicture_Annotations>");
                    Console.WriteLine($"[AnnotConverter] Successfully exported annotations ({sb.Length} bytes)");
                    e.result = sb.ToString();
                }
                finally
                {
                    am.Close();
                }
            }
            catch (Exception ex) { e.result = JsonErr("Export failed: " + ex.Message); }
        }

        private static void ExportOneAnnotation(StringBuilder sb, Annotation annot, Annotation.GdPictureAnnotationType type)
        {
            string typeStr = MapTypeToXmlString(type);
            Console.WriteLine($"[AnnotConverter] ExportOneAnnotation: input type={type}, mapped typeStr={typeStr}");
            dynamic d = annot;

            string guid = !string.IsNullOrWhiteSpace(annot.Guid) ? annot.Guid : Guid.NewGuid().ToString();
            string subject = typeStr.Replace("Annotation", "");
            try
            {
                if (d.Subject is string s && !string.IsNullOrWhiteSpace(s)) subject = s;
            }
            catch { }

            float left = annot.Left, top = annot.Top, width = annot.Width, height = annot.Height;
            bool stroke = true, fill = false;
            GdPictureColor strokeColor = new GdPictureColor(255, 0, 0, 0);
            GdPictureColor fillColor = GdPictureColor.Transparent;
            GdPictureColor fontColor = new GdPictureColor(255, 0, 0, 0);
            float borderWidth = 0.04f, opacity = 1f;

            try { stroke = d.Stroke; } catch { }
            try { fill = d.Fill; } catch { }
            try { strokeColor = d.StrokeColor; } catch { }
            try { fillColor = d.FillColor; } catch { }
            try { borderWidth = d.BorderWidth; } catch { }
            try { opacity = d.Opacity; } catch { }
            try { fontColor = d.ForeColor; } catch { }

            sb.AppendLine($"    <Annotation Type=\"{Esc(typeStr)}\" GUID=\"{Esc(guid)}\" Subject=\"{Esc(subject)}\">");

            if (type is Annotation.GdPictureAnnotationType.AnnotationTypeRectangle
                or Annotation.GdPictureAnnotationType.AnnotationTypeEllipse
                or Annotation.GdPictureAnnotationType.AnnotationTypeText
                or Annotation.GdPictureAnnotationType.AnnotationTypeStickyNote
                or Annotation.GdPictureAnnotationType.AnnotationTypeRubberStamp
                or Annotation.GdPictureAnnotationType.AnnotationTypeRedaction)
            {
                AppendBounds(sb, left, top, width, height);

                if (type is Annotation.GdPictureAnnotationType.AnnotationTypeText
                    or Annotation.GdPictureAnnotationType.AnnotationTypeStickyNote
                    or Annotation.GdPictureAnnotationType.AnnotationTypeRubberStamp
                    or Annotation.GdPictureAnnotationType.AnnotationTypeRedaction)
                {
                    string text = string.Empty;
                    string font = "Helvetica";
                    float fontSize = 14f;
                    string icon = "COMMENT";
                    string stampType = "Custom";
                    try { text = d.Text ?? string.Empty; } catch { }
                    try { text = d.Content ?? text; } catch { }
                    try { text = d.OverlayText ?? text; } catch { }
                    try { font = d.FontName ?? "Helvetica"; } catch { }
                    try { fontSize = d.FontSize; } catch { }
                    try { icon = d.Icon.ToString(); } catch { }
                    try { stampType = d.StampType.ToString(); } catch { }
                    try { stampType = d.Type.ToString(); } catch { }

                    if (type == Annotation.GdPictureAnnotationType.AnnotationTypeStickyNote)
                        sb.AppendLine($"      <Content Text=\"{Esc(text)}\" Font=\"{Esc(font)}\" FontSize=\"{F(fontSize)}\" Icon=\"{Esc(icon)}\" />");
                    else if (type == Annotation.GdPictureAnnotationType.AnnotationTypeRubberStamp)
                        sb.AppendLine($"      <Content Text=\"{Esc(text)}\" StampType=\"{Esc(stampType)}\" Font=\"{Esc(font)}\" FontSize=\"{F(fontSize)}\" />");
                    else if (type == Annotation.GdPictureAnnotationType.AnnotationTypeRedaction)
                        sb.AppendLine($"      <Content Text=\"{Esc(text)}\" OverlayText=\"{Esc(text)}\" Font=\"{Esc(font)}\" FontSize=\"{F(fontSize)}\" />");
                    else
                        sb.AppendLine($"      <Content Text=\"{Esc(text)}\" Font=\"{Esc(font)}\" FontSize=\"{F(fontSize)}\" />");
                }

                AppendAppearance(sb, stroke, strokeColor, fill, fillColor, borderWidth, opacity,
                    type == Annotation.GdPictureAnnotationType.AnnotationTypeText ? fontColor : null);
            }
            else if (type is Annotation.GdPictureAnnotationType.AnnotationTypeLine
                     or Annotation.GdPictureAnnotationType.AnnotationTypeLineArrow)
            {
                // A line is stored as its box (centre, width, height). FlipX/FlipY tell
                // which corners are the start and the end point (arrow at the end).
                bool flipX = false, flipY = false;
                try { flipX = d.FlipX; } catch { }
                try { flipY = d.FlipY; } catch { }
                float boxLeft = left - width / 2, boxRight = left + width / 2;
                float boxTop = top - height / 2, boxBottom = top + height / 2;
                float x1 = flipX ? boxRight : boxLeft, x2 = flipX ? boxLeft : boxRight;
                float y1 = flipY ? boxBottom : boxTop, y2 = flipY ? boxTop : boxBottom;

                sb.AppendLine($"      <StartPoint Left=\"{F(x1)}\" Top=\"{F(y1)}\" />");
                sb.AppendLine($"      <EndPoint Left=\"{F(x2)}\" Top=\"{F(y2)}\" />");
                AppendAppearance(sb, stroke, strokeColor, false, GdPictureColor.Transparent, borderWidth, opacity);
            }
            else if (type is Annotation.GdPictureAnnotationType.AnnotationTypePolygon
                     or Annotation.GdPictureAnnotationType.AnnotationTypeConnectedLines)
            {
                GdPicturePointF[]? pts = null;
                try { pts = d.Points as GdPicturePointF[]; } catch { }
                if (pts == null)
                {
                    try { pts = (GdPicturePointF[])d.Points; } catch { }
                }
                AppendPoints(sb, pts == null ? null : ToAbsolute(pts, left, top, width, height));
                AppendAppearance(sb, stroke, strokeColor, fill, fillColor, borderWidth, opacity);
            }
            else if (type == Annotation.GdPictureAnnotationType.AnnotationTypeFreeHand)
            {
                AppendFreehandLines(sb, d, left, top, width, height);
                AppendAppearance(sb, stroke, strokeColor, false, GdPictureColor.Transparent, borderWidth, opacity);
            }
            else if (IsTextMarkupType(type))
            {
                GdPicturePointF[] quadPoints = [];
                try { quadPoints = ToPointArray(d.QuadPoints); } catch { }
                if (quadPoints.Length == 0)
                {
                    try { quadPoints = ToPointArray(d.Points); } catch { }
                }

                if (quadPoints.Length > 0) AppendQuadPoints(sb, quadPoints);

                GdPictureColor markupColor = strokeColor;
                try { markupColor = d.Color; } catch { }
                try { markupColor = d.StrokeColor; } catch { }

                AppendAppearance(sb, true, markupColor, false, GdPictureColor.Transparent, borderWidth, opacity);
            }

            sb.AppendLine("    </Annotation>");
        }

        private static string MapTypeToXmlString(Annotation.GdPictureAnnotationType type)
        {
            string typeName = type.ToString();
            return type switch
            {
                Annotation.GdPictureAnnotationType.AnnotationTypeRectangle => "AnnotationRectangle",
                Annotation.GdPictureAnnotationType.AnnotationTypeEllipse => "AnnotationEllipse",
                Annotation.GdPictureAnnotationType.AnnotationTypeLine => "AnnotationLine",
                Annotation.GdPictureAnnotationType.AnnotationTypeLineArrow => "AnnotationLineArrow",
                Annotation.GdPictureAnnotationType.AnnotationTypePolygon => "AnnotationPolygon",
                Annotation.GdPictureAnnotationType.AnnotationTypeConnectedLines => "AnnotationConnectedLines",
                Annotation.GdPictureAnnotationType.AnnotationTypeFreeHand => "AnnotationFreeHand",
                Annotation.GdPictureAnnotationType.AnnotationTypeText => "AnnotationText",
                Annotation.GdPictureAnnotationType.AnnotationTypeStickyNote => "AnnotationStickyNote",
                Annotation.GdPictureAnnotationType.AnnotationTypeRubberStamp => "AnnotationRubberStamp",
                Annotation.GdPictureAnnotationType.AnnotationTypeRedaction => "AnnotationRedaction",
                _ when typeName.Contains("Highlight", StringComparison.OrdinalIgnoreCase) => "AnnotationHighlight",
                _ when typeName.Contains("Underline", StringComparison.OrdinalIgnoreCase) => "AnnotationUnderline",
                _ when typeName.Contains("Strike", StringComparison.OrdinalIgnoreCase) => "AnnotationStrikeOut",
                _ when typeName.Contains("Squigg", StringComparison.OrdinalIgnoreCase) => "AnnotationSquiggly",
                _ => "AnnotationRectangle"
            };
        }

        private static bool IsTextMarkupType(Annotation.GdPictureAnnotationType type)
        {
            string mapped = MapTypeToXmlString(type);
            return mapped is "AnnotationHighlight" or "AnnotationUnderline" or "AnnotationStrikeOut" or "AnnotationSquiggly";
        }

        // =====================================================================
        //  IMPORT: Parse XML → create annotations via AnnotationManager
        // =====================================================================
        private static void ImportAnnotations(GdPicture14.WEB.CustomActionEventArgs e)
        {
            try
            {
                Console.WriteLine("[AnnotConverter] ImportAnnotations called");
                string xmlData = e.args as string ?? string.Empty;
                if (string.IsNullOrWhiteSpace(xmlData)) { e.result = JsonErr("No XML data"); return; }

                var am = InitAnnotationManager(e);
                if (am == null) { e.result = JsonErr("Could not access document"); return; }

                var xmlDoc = new XmlDocument();
                xmlDoc.LoadXml(xmlData);
                int imported = 0;

                var pageNodes = xmlDoc.SelectNodes("//Page");
                if (pageNodes == null) { e.result = JsonErr("No Page elements"); return; }

                foreach (XmlNode pageNode in pageNodes)
                {
                    int pageIdx = int.Parse(pageNode.Attributes?["Index"]?.Value ?? "0");
                    am.SelectPage(pageIdx + 1);

                    foreach (XmlNode node in pageNode.SelectNodes("Annotation")!)
                    {
                        if (ImportOneAnnotation(am, node)) imported++;
                    }
                    am.SaveAnnotationsToPage();
                }

                am.Close();
                e.docuVieware.ReloadAnnotations();
                e.docuVieware.RedrawPage();

                Console.WriteLine($"[AnnotConverter] Imported {imported} annotations");
                e.result = JsonSerializer.Serialize(new { success = true, imported });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AnnotConverter] EXCEPTION: {ex}");
                e.result = JsonErr("Import failed: " + ex.Message);
            }
        }

        private static bool ImportOneAnnotation(AnnotationManager am, XmlNode node)
        {
            string type = node.Attributes?["Type"]?.Value ?? "";
            var appearance = node.SelectSingleNode("Appearance");
            float bw = PF(appearance, "BorderWidth", 0.04f);
            float opacity = PF(appearance, "Opacity", 1f);
            var borderColor = HexToGdColor(PA(appearance, "BorderColor", "#000000ff"));
            var fillColorStr = PA(appearance, "FillColor", "transparent");
            var fillColor = fillColorStr == "transparent" ? GdPictureColor.Transparent : HexToGdColor(fillColorStr);
            bool hasFill = fillColorStr != "transparent";

            switch (type)
            {
                case "AnnotationRectangle":
                case "AnnotationEllipse":
                {
                    var b = node.SelectSingleNode("Bounds");
                    if (b == null) return false;
                    float l = PF(b, "Left"), t = PF(b, "Top"), w = PF(b, "Width"), h = PF(b, "Height");

                    if (type == "AnnotationRectangle")
                    {
                        // XML Bounds give the centre; AddRectangleAnnot takes the top-left corner.
                        var a = am.AddRectangleAnnot(borderColor, fillColor, l - w / 2, t - h / 2, w, h);
                        if (a == null) return false;
                        a.Stroke = true; a.StrokeColor = borderColor;
                        a.Fill = hasFill; a.FillColor = fillColor;
                        a.BorderWidth = bw; a.Opacity = opacity;
                    }
                    else
                    {
                        // This AddEllipseAnnot overload places the ellipse by its centre.
                        var a = am.AddEllipseAnnot(borderColor, l, t, w, h);
                        if (a == null) return false;
                        a.Stroke = true; a.StrokeColor = borderColor;
                        a.Fill = hasFill; a.FillColor = fillColor;
                        a.BorderWidth = bw; a.Opacity = opacity;
                    }
                    return true;
                }

                case "AnnotationLine":
                case "AnnotationLineArrow":
                {
                    var sp = node.SelectSingleNode("StartPoint");
                    var ep = node.SelectSingleNode("EndPoint");
                    if (sp == null || ep == null) return false;
                    float x1 = PF(sp, "Left"), y1 = PF(sp, "Top");
                    float x2 = PF(ep, "Left"), y2 = PF(ep, "Top");

                    if (type == "AnnotationLineArrow")
                    {
                        var a = am.AddLineArrowAnnot(borderColor, x1, y1, x2, y2);
                        if (a == null) return false;
                        a.BorderWidth = bw; a.Opacity = opacity;
                    }
                    else
                    {
                        var a = am.AddLineAnnot(borderColor, x1, y1, x2, y2);
                        if (a == null) return false;
                        a.BorderWidth = bw; a.Opacity = opacity;
                    }
                    return true;
                }

                case "AnnotationPolygon":
                {
                    var pts = ParsePoints(node);
                    if (pts == null || pts.Length < 2) return false;
                    var a = am.AddPolygonAnnot(borderColor, fillColor, pts);
                    if (a == null) return false;
                    a.Stroke = true; a.StrokeColor = borderColor;
                    a.Fill = hasFill; a.FillColor = fillColor;
                    a.BorderWidth = bw; a.Opacity = opacity;
                    return true;
                }

                case "AnnotationPolyline":
                case "AnnotationConnectedLines":
                {
                    var pts = ParsePoints(node);
                    if (pts == null || pts.Length < 2) return false;
                    var a = am.AddConnectedLinesAnnot(borderColor, pts);
                    if (a == null) return false;
                    a.BorderWidth = bw; a.Opacity = opacity;
                    return true;
                }

                case "AnnotationFreeHand":
                {
                    var lineNode = node.SelectSingleNode("Lines/Line");
                    var pointNodes = lineNode?.SelectNodes("Point");
                    if (pointNodes == null || pointNodes.Count < 2) return false;
                    var pts = new GdPicturePointF[pointNodes.Count];
                    for (int i = 0; i < pointNodes.Count; i++)
                        pts[i] = new GdPicturePointF(PF(pointNodes[i], "Left"), PF(pointNodes[i], "Top"));
                    var a = am.AddFreeHandAnnot(borderColor, pts);
                    if (a == null) return false;
                    a.BorderWidth = bw; a.Opacity = opacity;
                    return true;
                }

                case "AnnotationText":
                {
                    var b = node.SelectSingleNode("Bounds");
                    var c = node.SelectSingleNode("Content");
                    if (b == null) return false;
                    float l = PF(b, "Left"), t = PF(b, "Top"), w = PF(b, "Width"), h = PF(b, "Height");
                    var a = am.AddTextAnnot(l - w / 2, t - h / 2, w, h, c?.Attributes?["Text"]?.Value ?? "");
                    if (a == null) return false;
                    a.Opacity = opacity; a.BorderWidth = bw;
                    if (c?.Attributes?["Font"]?.Value is string font) a.FontName = font;
                    if (float.TryParse(c?.Attributes?["FontSize"]?.Value, Inv, out float fs)) a.FontSize = fs;
                    var fc = PA(appearance, "FontColor", "#000000ff");
                    a.ForeColor = HexToGdColor(fc);
                    return true;
                }

                case "AnnotationStickyNote":
                {
                    var b = node.SelectSingleNode("Bounds");
                    var c = node.SelectSingleNode("Content");
                    if (b == null) return false;
                    float l = PF(b, "Left"), t = PF(b, "Top"), w = PF(b, "Width"), h = PF(b, "Height");
                    var a = am.AddStickyNoteAnnot(l - w / 2, t - h / 2, w, h, c?.Attributes?["Text"]?.Value ?? "");
                    if (a == null) return false;
                    a.Opacity = opacity;
                    return true;
                }

                case "AnnotationRubberStamp":
                {
                    var b = node.SelectSingleNode("Bounds");
                    var c = node.SelectSingleNode("Content");
                    if (b == null) return false;
                    float l = PF(b, "Left"), t = PF(b, "Top"), w = PF(b, "Width"), h = PF(b, "Height");
                    string stampText = c?.Attributes?["Text"]?.Value ?? "";
                    var a = am.AddRubberStampAnnot(borderColor, l - w / 2, t - h / 2, w, h, stampText);
                    if (a == null) return false;
                    a.Stroke = true; a.StrokeColor = borderColor;
                    a.BorderWidth = bw; a.Opacity = opacity;
                    try { ((dynamic)a).StampType = c?.Attributes?["StampType"]?.Value ?? "Custom"; } catch { }
                    return true;
                }

                default: return false;
            }
        }

        // =====================================================================
        //  CLEAR
        // =====================================================================
        private static void ClearAnnotations(GdPicture14.WEB.CustomActionEventArgs e)
        {
            try
            {
                var am = InitAnnotationManager(e);
                if (am == null) { e.result = JsonErr("Could not access document"); return; }
                for (int p = 1; p <= am.PageCount; p++)
                {
                    am.SelectPage(p);
                    for (int i = am.GetAnnotationCount() - 1; i >= 0; i--) am.DeleteAnnotation(i);
                    am.SaveAnnotationsToPage();
                }
                am.Close();
                e.docuVieware.ReloadAnnotations();
                e.docuVieware.RedrawPage();
                e.result = JsonSerializer.Serialize(new { success = true });
            }
            catch (Exception ex) { e.result = JsonErr("Clear failed: " + ex.Message); }
        }

        // =====================================================================
        //  Helpers
        // =====================================================================
        private static string F(float v) => v.ToString("F6", Inv);
        private static string Esc(string s) => System.Security.SecurityElement.Escape(s) ?? s;
        private static string JsonErr(string msg) => JsonSerializer.Serialize(new { error = msg });

        private static string ColorToHex(GdPictureColor color)
        {
            var raw = color.ToHexStringWithAlpha().TrimStart('#');
            if (raw.Length == 8)
                return "#" + raw.Substring(2, 6) + raw.Substring(0, 2);
            return "#" + raw;
        }

        private static void AppendBounds(StringBuilder sb, float l, float t, float w, float h)
            => sb.AppendLine($"      <Bounds Left=\"{F(l)}\" Top=\"{F(t)}\" Width=\"{F(w)}\" Height=\"{F(h)}\" />");

        private static void AppendAppearance(StringBuilder sb, bool stroke, GdPictureColor strokeColor,
            bool fill, GdPictureColor fillColor, float borderWidth, float opacity, GdPictureColor? fontColor = null)
        {
            string bc = stroke ? ColorToHex(strokeColor) : "#000000ff";
            string fc = fill ? ColorToHex(fillColor) : "transparent";
            string font = fontColor.HasValue ? $" FontColor=\"{ColorToHex(fontColor.Value)}\"" : string.Empty;
            sb.AppendLine($"      <Appearance BorderColor=\"{bc}\" FillColor=\"{fc}\"{font} BorderWidth=\"{F(borderWidth)}\" Opacity=\"{F(opacity)}\" />");
        }

        private static void AppendPoints(StringBuilder sb, GdPicturePointF[]? pts)
        {
            sb.AppendLine("      <Points>");
            if (pts != null)
                foreach (var p in pts)
                    sb.AppendLine($"        <Point Left=\"{F(p.X)}\" Top=\"{F(p.Y)}\" />");
            sb.AppendLine("      </Points>");
        }

        private static void AppendQuadPoints(StringBuilder sb, GdPicturePointF[]? pts)
        {
            sb.AppendLine("      <QuadPoints>");
            if (pts != null)
                foreach (var p in pts)
                    sb.AppendLine($"        <Point Left=\"{F(p.X)}\" Top=\"{F(p.Y)}\" />");
            sb.AppendLine("      </QuadPoints>");
        }

        private static void AppendFreehandLines(StringBuilder sb, dynamic d, float left, float top, float width, float height)
        {
            sb.AppendLine("      <Lines>");

            bool wroteOne = false;
            try
            {
                if (d.Lines is IEnumerable lines)
                {
                    foreach (var line in lines)
                    {
                        GdPicturePointF[] pts = ToAbsolute(ToPointArray(line), left, top, width, height);
                        if (pts.Length == 0) continue;
                        wroteOne = true;
                        sb.AppendLine("        <Line>");
                        foreach (var p in pts)
                            sb.AppendLine($"          <Point Left=\"{F(p.X)}\" Top=\"{F(p.Y)}\" />");
                        sb.AppendLine("        </Line>");
                    }
                }
            }
            catch { }

            if (!wroteOne)
            {
                GdPicturePointF[] pts = [];
                try { pts = ToAbsolute(ToPointArray(d.Points), left, top, width, height); } catch { }
                if (pts.Length > 0)
                {
                    sb.AppendLine("        <Line>");
                    foreach (var p in pts)
                        sb.AppendLine($"          <Point Left=\"{F(p.X)}\" Top=\"{F(p.Y)}\" />");
                    sb.AppendLine("        </Line>");
                }
            }

            sb.AppendLine("      </Lines>");
        }

        /// <summary>
        /// GdPicture keeps Left/Top at the centre of an annotation and the points of lines,
        /// polygons and freehand paths relative to the top-left corner of its box. The XML
        /// uses absolute page coordinates (inches), so relative points are moved back onto
        /// the page. Points already outside the box are taken as absolute.
        /// </summary>
        private static GdPicturePointF[] ToAbsolute(GdPicturePointF[] points, float left, float top, float width, float height)
        {
            const float tolerance = 0.01f;
            float boxWidth = Math.Abs(width), boxHeight = Math.Abs(height);
            bool relative = points.Length > 0 && points.All(p =>
                p.X >= -tolerance && p.X <= boxWidth + tolerance && p.Y >= -tolerance && p.Y <= boxHeight + tolerance);
            if (!relative) return points;
            float originX = left - boxWidth / 2, originY = top - boxHeight / 2;
            return points.Select(p => new GdPicturePointF(originX + p.X, originY + p.Y)).ToArray();
        }

        private static GdPicturePointF[] ToPointArray(object? value)
        {
            if (value is null) return [];
            if (value is GdPicturePointF[] direct) return direct;
            if (value is IEnumerable enumerable)
            {
                var list = new List<GdPicturePointF>();
                foreach (var item in enumerable)
                {
                    if (TryToPoint(item, out var p)) list.Add(p);
                }
                return [.. list];
            }
            return [];
        }

        private static bool TryToPoint(object? value, out GdPicturePointF point)
        {
            if (value is GdPicturePointF p)
            {
                point = p;
                return true;
            }

            point = new GdPicturePointF();
            if (value == null) return false;

            float x = 0f, y = 0f;
            bool hasX = TryReadFloatMember(value, "X", ref x) || TryReadFloatMember(value, "Left", ref x);
            bool hasY = TryReadFloatMember(value, "Y", ref y) || TryReadFloatMember(value, "Top", ref y);
            if (!hasX || !hasY) return false;

            point = new GdPicturePointF(x, y);
            return true;
        }

        private static bool TryReadFloatMember(object obj, string memberName, ref float target)
        {
            try
            {
                var t = obj.GetType();
                var prop = t.GetProperty(memberName);
                if (prop != null)
                {
                    var v = prop.GetValue(obj);
                    if (v != null)
                    {
                        target = Convert.ToSingle(v, Inv);
                        return true;
                    }
                }
                var field = t.GetField(memberName);
                if (field != null)
                {
                    var v = field.GetValue(obj);
                    if (v != null)
                    {
                        target = Convert.ToSingle(v, Inv);
                        return true;
                    }
                }
            }
            catch { }

            return false;
        }

        private static GdPicturePointF[]? ParsePoints(XmlNode node)
        {
            var nodes = node.SelectNodes("Points/Point");
            if (nodes == null || nodes.Count == 0) return null;
            var pts = new GdPicturePointF[nodes.Count];
            for (int i = 0; i < nodes.Count; i++)
                pts[i] = new GdPicturePointF(PF(nodes[i], "Left"), PF(nodes[i], "Top"));
            return pts;
        }

        private static float PF(XmlNode? node, string attr, float def = 0f)
        {
            var val = node?.Attributes?[attr]?.Value;
            return val != null ? float.Parse(val, Inv) : def;
        }

        private static string PA(XmlNode? node, string attr, string def = "")
            => node?.Attributes?[attr]?.Value ?? def;

        private static GdPictureColor HexToGdColor(string hex)
        {
            hex = hex.TrimStart('#');
            if (hex.Length == 6) hex += "ff";
            byte r = (byte)Convert.ToInt32(hex[..2], 16);
            byte g = (byte)Convert.ToInt32(hex[2..4], 16);
            byte b = (byte)Convert.ToInt32(hex[4..6], 16);
            byte a = hex.Length >= 8 ? (byte)Convert.ToInt32(hex[6..8], 16) : (byte)255;
            return new GdPictureColor(a, r, g, b);
        }
    }
}
