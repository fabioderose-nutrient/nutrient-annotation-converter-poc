// ============================================================================
//  Annotation Converter — DocuVieware <-> Nutrient WebSDK
//
//  Bidirectional conversion of annotations between GdPicture/DocuVieware
//  proprietary XML format and Nutrient InstantJSON.
//
//  Supported types: Rectangle, Ellipse, Line, Polygon, Polyline,
//                   Ink/FreeHand, Text, Note/StickyNote
// ============================================================================

(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  //  Configuration
  // ─────────────────────────────────────────────────────────────────────────
  var BACKEND_URL = window.location.origin;
  var DV_CONTROL_ID = "DocuVieware1";
  var NUTRIENT_CDN = "https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.7.0/";
  var NUTRIENT_JS = NUTRIENT_CDN + "nutrient-viewer.js";
  var SAMPLE_PDF = "sample.pdf";

  // DocuVieware uses inches, WebSDK uses PDF points (1 inch = 72 points)
  var PPI = 72;

  // Mapping: DV XML Type ↔ InstantJSON type
  var DV_TO_WS = {
    AnnotationRectangle: "pspdfkit/shape/rectangle",
    AnnotationEllipse: "pspdfkit/shape/ellipse",
    AnnotationLine: "pspdfkit/shape/line",
    AnnotationLineArrow: "pspdfkit/shape/line",
    AnnotationPolygon: "pspdfkit/shape/polygon",
    AnnotationPolyline: "pspdfkit/shape/polyline",
    AnnotationConnectedLines: "pspdfkit/shape/polyline",
    AnnotationFreeHand: "pspdfkit/ink",
    AnnotationText: "pspdfkit/text",
    AnnotationStickyNote: "pspdfkit/note",
    AnnotationRubberStamp: "pspdfkit/stamp",
    AnnotationRedaction: "pspdfkit/redaction",
    AnnotationHighlight: "pspdfkit/markup/highlight",
    AnnotationUnderline: "pspdfkit/markup/underline",
    AnnotationStrikeOut: "pspdfkit/markup/strikeout",
    AnnotationSquiggly: "pspdfkit/markup/squiggly",
  };
  // Explicit reverse mapping — avoids AnnotationLineArrow overwriting AnnotationLine
  var WS_TO_DV = {
    "pspdfkit/shape/rectangle": "AnnotationRectangle",
    "pspdfkit/shape/ellipse": "AnnotationEllipse",
    "pspdfkit/shape/line": "AnnotationLine",
    "pspdfkit/shape/polygon": "AnnotationPolygon",
    "pspdfkit/shape/polyline": "AnnotationPolyline",
    "pspdfkit/ink": "AnnotationFreeHand",
    "pspdfkit/text": "AnnotationText",
    "pspdfkit/note": "AnnotationStickyNote",
    "pspdfkit/stamp": "AnnotationRubberStamp",
    "pspdfkit/redaction": "AnnotationRedaction",
    "pspdfkit/markup/highlight": "AnnotationHighlight",
    "pspdfkit/markup/underline": "AnnotationUnderline",
    "pspdfkit/markup/strikeout": "AnnotationStrikeOut",
    "pspdfkit/markup/squiggly": "AnnotationSquiggly",
  };

  var TEXT_MARKUP_DV_TYPES = ["AnnotationHighlight", "AnnotationUnderline", "AnnotationStrikeOut", "AnnotationSquiggly"];
  var TEXT_MARKUP_WS_TYPES = ["pspdfkit/markup/highlight", "pspdfkit/markup/underline", "pspdfkit/markup/strikeout", "pspdfkit/markup/squiggly"];

  // Types that use Bounds (center-based box)
  var BOUNDS_TYPES = ["AnnotationRectangle", "AnnotationEllipse", "AnnotationText", "AnnotationStickyNote", "AnnotationRubberStamp", "AnnotationRedaction"];

  // ─────────────────────────────────────────────────────────────────────────
  //  State
  // ─────────────────────────────────────────────────────────────────────────
  var NV = null;
  var wsInstance = null;
  var dvReady = false;
  var wsReady = false;
  var dvAnnotations = {};
  var dvAnnotationsXmp = null;
  var dvSessionId = uuid();

  var currentTheme = readTheme();

  function readTheme() {
    try { return localStorage.getItem("poc-theme") || "light"; } catch (_) { return "light"; }
  }
  // Nutrient Web SDK license key served by GET /api/config (empty = evaluation mode).
  var webSdkLicenseKey = "";
  document.documentElement.setAttribute("data-theme", currentTheme);

  // ─────────────────────────────────────────────────────────────────────────
  //  Utility: UUID, Colors, XML, File
  // ─────────────────────────────────────────────────────────────────────────
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function parseColor(color) {
    if (!color || color === "transparent" || color === "none") return null;
    if (typeof color === "object") {
      return { r: color.r || color.R || 0, g: color.g || color.G || 0, b: color.b || color.B || 0,
               a: color.a !== undefined ? color.a : color.A !== undefined ? color.A : 255 };
    }
    if (typeof color !== "string") return null;
    var m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
      var af = m[4] !== undefined ? parseFloat(m[4]) : 1;
      return { r: +m[1], g: +m[2], b: +m[3], a: af <= 1 ? Math.round(af * 255) : Math.round(af) };
    }
    var h = color.replace("#", "");
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length >= 6) return { r: parseInt(h.substr(0,2),16)||0, g: parseInt(h.substr(2,2),16)||0,
      b: parseInt(h.substr(4,2),16)||0, a: h.length >= 8 ? parseInt(h.substr(6,2),16) : 255 };
    return null;
  }

  function toHex6(c) { var o = parseColor(c); if (!o) return null;
    return "#"+("0"+o.r.toString(16)).slice(-2)+("0"+o.g.toString(16)).slice(-2)+("0"+o.b.toString(16)).slice(-2); }
  function toHex8(c) { var o = parseColor(c); if (!o) return "transparent";
    return "#"+("0"+o.r.toString(16)).slice(-2)+("0"+o.g.toString(16)).slice(-2)+("0"+o.b.toString(16)).slice(-2)+("0"+o.a.toString(16)).slice(-2); }

  function escapeXml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function downloadFile(content, filename, mime) {
    var b = new Blob([content], { type: mime }), u = URL.createObjectURL(b), a = document.createElement("a");
    a.href = u; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(u);
  }

  function showToast(message, type) {
    type = type || "info"; var c = document.getElementById("toast-container"); if (!c) return;
    var t = document.createElement("div"); t.className = "toast toast-" + type; t.textContent = message;
    c.appendChild(t); setTimeout(function(){t.classList.add("visible");},10);
    setTimeout(function(){t.classList.remove("visible");setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},300);},3500);
  }

  // Helper: make NV.Color from hex or parseColor result
  function nvColor(c) {
    var o = typeof c === "string" ? parseColor(c) : c;
    if (!o) return null;
    return new NV.Color({ r: o.r, g: o.g, b: o.b });
  }

  function quadPointsToRects(quadPointsPt) {
    var rects = [];
    if (!quadPointsPt || quadPointsPt.length < 4) return rects;
    for (var i = 0; i + 3 < quadPointsPt.length; i += 4) {
      var p1 = quadPointsPt[i], p2 = quadPointsPt[i + 1], p3 = quadPointsPt[i + 2], p4 = quadPointsPt[i + 3];
      var minX = Math.min(p1[0], p2[0], p3[0], p4[0]);
      var minY = Math.min(p1[1], p2[1], p3[1], p4[1]);
      var maxX = Math.max(p1[0], p2[0], p3[0], p4[0]);
      var maxY = Math.max(p1[1], p2[1], p3[1], p4[1]);
      rects.push([minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1)]);
    }
    return rects;
  }

  function normalizeMarkupRects(rects, fallbackBbox) {
    var out = [];
    var src = rects || [];
    for (var i = 0; i < src.length; i++) {
      var r = src[i];
      if (Array.isArray(r) && r.length >= 4) out.push([+r[0] || 0, +r[1] || 0, Math.max(+r[2] || 0, 1), Math.max(+r[3] || 0, 1)]);
      else if (r && typeof r === "object") {
        var left = r.left !== undefined ? r.left : r.x;
        var top = r.top !== undefined ? r.top : r.y;
        out.push([+left || 0, +top || 0, Math.max(+r.width || 0, 1), Math.max(+r.height || 0, 1)]);
      }
    }
    if (out.length === 0 && fallbackBbox && fallbackBbox.length >= 4)
      out.push([+fallbackBbox[0] || 0, +fallbackBbox[1] || 0, Math.max(+fallbackBbox[2] || 0, 1), Math.max(+fallbackBbox[3] || 0, 1)]);
    return out;
  }

  function bboxFromRects(rects) {
    if (!rects || rects.length === 0) return [0, 0, 72, 72];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var l = r[0], t = r[1], rr = l + r[2], bb = t + r[3];
      if (l < minX) minX = l;
      if (t < minY) minY = t;
      if (rr > maxX) maxX = rr;
      if (bb > maxY) maxY = bb;
    }
    return [minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1)];
  }

  function rectsToQuadPoints(rectsPt) {
    var points = [];
    for (var i = 0; i < rectsPt.length; i++) {
      var r = rectsPt[i];
      var left = r[0], top = r[1], right = r[0] + r[2], bottom = r[1] + r[3];
      points.push([left, top], [right, top], [right, bottom], [left, bottom]);
    }
    return points;
  }

  // =========================================================================
  //  CORE: GdPicture XML → InstantJSON
  //
  //  DV XML Bounds use center coordinates (inches).
  //  DV XML Points use absolute coordinates (inches).
  //  InstantJSON uses top-left bbox in PDF points.
  // =========================================================================

  function xmlToInstantJSON(xmlString) {
    var doc = new DOMParser().parseFromString(xmlString, "application/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("Invalid XML: " + err.textContent.substring(0, 200));

    var annotations = [];
    var pages = doc.querySelectorAll("Page");

    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      var pageIndex = parseInt(page.getAttribute("Index") || "0", 10);
      var annots = page.querySelectorAll("Annotation");

      for (var a = 0; a < annots.length; a++) {
         var node = annots[a];
         var dvType = node.getAttribute("Type");
         var wsType = DV_TO_WS[dvType];
         console.log("[xmlToInstantJSON] dvType:", dvType, "wsType:", wsType);
         if (!wsType) continue;

        var appearance = node.querySelector("Appearance");
        var opacity = appearance ? parseFloat(appearance.getAttribute("Opacity") || "1") : 1;
        var bwIn = appearance ? parseFloat(appearance.getAttribute("BorderWidth") || "0.04") : 0.04;
        var borderColor = appearance ? appearance.getAttribute("BorderColor") : "#000000ff";
        var fillColor = appearance ? appearance.getAttribute("FillColor") : "transparent";
        var id = node.getAttribute("GUID") || uuid();

        var base = { v: 1, type: wsType, pageIndex: pageIndex, opacity: opacity,
          strokeColor: toHex6(borderColor) || "#000000", strokeWidth: bwIn * PPI,
          blendMode: "normal", id: id, creatorName: "DocuVieware", name: "" };

         // Bounds-based types (center → top-left)
         if (BOUNDS_TYPES.indexOf(dvType) !== -1) {
           console.log("[xmlToInstantJSON] Processing as BOUNDS type");
           var b = node.querySelector("Bounds");
          if (!b) continue;
          var wIn = parseFloat(b.getAttribute("Width") || "0");
          var hIn = parseFloat(b.getAttribute("Height") || "0");
          base.bbox = [
            (parseFloat(b.getAttribute("Left") || "0") - wIn / 2) * PPI,
            (parseFloat(b.getAttribute("Top") || "0") - hIn / 2) * PPI,
            wIn * PPI, hIn * PPI
          ];
          if (fillColor && fillColor !== "transparent") base.fillColor = toHex6(fillColor);
          else base.fillColor = null;

          // Text-specific
          if (dvType === "AnnotationText" || dvType === "AnnotationStickyNote" || dvType === "AnnotationRubberStamp" || dvType === "AnnotationRedaction") {
            var content = node.querySelector("Content");
            base.text = content ? (content.getAttribute("Text") || "") : "";
            if (dvType === "AnnotationText") {
              base.font = content ? (content.getAttribute("Font") || "Helvetica") : "Helvetica";
              base.fontSize = content ? parseFloat(content.getAttribute("FontSize") || "14") : 14;
              base.fontColor = appearance ? (toHex6(appearance.getAttribute("FontColor")) || "#000000") : "#000000";
              base.horizontalAlign = "left";
              base.verticalAlign = "top";
            }
            if (dvType === "AnnotationStickyNote") {
              base.icon = content ? (content.getAttribute("Icon") || "COMMENT") : "COMMENT";
            }
            if (dvType === "AnnotationRubberStamp") {
              base.stampType = content ? (content.getAttribute("StampType") || "Custom") : "Custom";
              if (base.text) base.title = base.text;
              delete base.text;
            }
            if (dvType === "AnnotationRedaction") {
              base.overlayText = content
                ? (content.getAttribute("OverlayText") || content.getAttribute("Text") || "")
                : "";
            }
           }

           console.log("[xmlToInstantJSON] Created annotation:", base.type, base);
           annotations.push(base);
           continue;
        }

         // Line type (two endpoints)
         if (dvType === "AnnotationLine" || dvType === "AnnotationLineArrow") {
           console.log("[xmlToInstantJSON] Processing as LINE type");
           var sp = node.querySelector("StartPoint");
          var ep = node.querySelector("EndPoint");
          if (!sp || !ep) continue;
          var x1 = parseFloat(sp.getAttribute("Left") || "0") * PPI;
          var y1 = parseFloat(sp.getAttribute("Top") || "0") * PPI;
          var x2 = parseFloat(ep.getAttribute("Left") || "0") * PPI;
          var y2 = parseFloat(ep.getAttribute("Top") || "0") * PPI;
          var minX = Math.min(x1, x2), minY = Math.min(y1, y2);
          base.bbox = [minX, minY, Math.max(Math.abs(x2 - x1), 1), Math.max(Math.abs(y2 - y1), 1)];
          base.startPoint = [x1, y1];
          base.endPoint = [x2, y2];
          if (dvType === "AnnotationLineArrow") {
            base.lineCaps = { end: "openArrow" };
          }
          annotations.push(base);
          continue;
        }

         if (TEXT_MARKUP_DV_TYPES.indexOf(dvType) !== -1) {
           console.log("[xmlToInstantJSON] Processing as TEXT_MARKUP type");
           var qpNodes = node.querySelectorAll("QuadPoints > Point");
          var quadPointsPt = [];
          for (var qpi = 0; qpi < qpNodes.length; qpi++) {
            quadPointsPt.push([
              parseFloat(qpNodes[qpi].getAttribute("Left") || "0") * PPI,
              parseFloat(qpNodes[qpi].getAttribute("Top") || "0") * PPI
            ]);
          }

          var rects = quadPointsToRects(quadPointsPt);
          if (rects.length === 0) {
            var fb = node.querySelector("Bounds");
            if (fb) {
              var fbWIn = parseFloat(fb.getAttribute("Width") || "0");
              var fbHIn = parseFloat(fb.getAttribute("Height") || "0");
              rects = [[
                (parseFloat(fb.getAttribute("Left") || "0") - fbWIn / 2) * PPI,
                (parseFloat(fb.getAttribute("Top") || "0") - fbHIn / 2) * PPI,
                fbWIn * PPI,
                fbHIn * PPI
              ]];
            }
          }

          base.rects = rects;
          base.bbox = bboxFromRects(rects);
          base.strokeColor = toHex6(borderColor) || "#ffff00";
          annotations.push(base);
          continue;
        }

         // Point-array types (polygon, polyline, freehand)
         // Polygons and polylines use <Points>, freehand paths use <Lines><Line>.
         var pointNodes = node.querySelectorAll("Points > Point, Lines > Line > Point");
         if (pointNodes && pointNodes.length > 0) {
           console.log("[xmlToInstantJSON] Processing as POINTS type");
           var pts = [], mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
          for (var i = 0; i < pointNodes.length; i++) {
            var px = parseFloat(pointNodes[i].getAttribute("Left") || "0") * PPI;
            var py = parseFloat(pointNodes[i].getAttribute("Top") || "0") * PPI;
            pts.push([px, py]);
            if (px < mnX) mnX = px; if (py < mnY) mnY = py;
            if (px > mxX) mxX = px; if (py > mxY) mxY = py;
          }
          base.bbox = [mnX, mnY, Math.max(mxX - mnX, 1), Math.max(mxY - mnY, 1)];

          if (dvType === "AnnotationFreeHand") {
            // Ink: lines is array of stroke arrays
            var lineNodes = node.querySelectorAll("Lines > Line");
            if (lineNodes && lineNodes.length > 0) {
              var lines = [];
              mnX = Infinity; mnY = Infinity; mxX = -Infinity; mxY = -Infinity;
              for (var l = 0; l < lineNodes.length; l++) {
                var lpts = lineNodes[l].querySelectorAll("Point");
                var stroke = [];
                for (var j = 0; j < lpts.length; j++) {
                  var lx = parseFloat(lpts[j].getAttribute("Left") || "0") * PPI;
                  var ly = parseFloat(lpts[j].getAttribute("Top") || "0") * PPI;
                  stroke.push([lx, ly]);
                  if (lx < mnX) mnX = lx; if (ly < mnY) mnY = ly;
                  if (lx > mxX) mxX = lx; if (ly > mxY) mxY = ly;
                }
                lines.push(stroke);
              }
              base.bbox = [mnX, mnY, Math.max(mxX - mnX, 1), Math.max(mxY - mnY, 1)];
              base.lines = lines;
              base.isDrawnNaturally = false;
            } else {
              base.lines = [pts];
              base.isDrawnNaturally = false;
            }
          } else {
            base.points = pts;
            if (dvType === "AnnotationPolygon" && fillColor && fillColor !== "transparent")
              base.fillColor = toHex6(fillColor);
          }

          annotations.push(base);
        }
      }
    }

    return { format: "https://pspdfkit.com/instant-json/v1", pdfId: null, annotations: annotations };
  }

  // =========================================================================
  //  CORE: InstantJSON → GdPicture XML
  //
  //  InstantJSON bbox is top-left in points.
  //  DV XML Bounds use center in inches. Points use absolute inches.
  //  Backend AddRectangleAnnot etc. take top-left inches.
  // =========================================================================

  var SUPPORTED_WS_TYPES = [
    "pspdfkit/shape/rectangle", "pspdfkit/shape/ellipse", "pspdfkit/shape/line",
    "pspdfkit/shape/polygon", "pspdfkit/shape/polyline", "pspdfkit/ink",
    "pspdfkit/text", "pspdfkit/note", "pspdfkit/stamp", "pspdfkit/redaction",
    "pspdfkit/markup/highlight", "pspdfkit/markup/underline", "pspdfkit/markup/strikeout", "pspdfkit/markup/squiggly"
  ];

  function instantJSONToXml(json) {
    var anns = ((json && json.annotations) || []).filter(function (a) {
      return SUPPORTED_WS_TYPES.indexOf(a.type) !== -1;
    });

    // Group by page
    var pages = {};
    anns.forEach(function (a) { var pi = a.pageIndex || 0; if (!pages[pi]) pages[pi] = []; pages[pi].push(a); });

    var xml = '<?xml version="1.0" encoding="utf-8"?>\n<GdPicture_Annotations Version="1.0">\n';
    Object.keys(pages).sort(function (a, b) { return a - b; }).forEach(function (pi) {
      xml += '  <Page Index="' + pi + '">\n';
      pages[pi].forEach(function (ann) { xml += annToXml(ann); });
      xml += '  </Page>\n';
    });
    xml += '</GdPicture_Annotations>';
    return xml;
  }

  function annToXml(ann) {
    var dvType = WS_TO_DV[ann.type] || "AnnotationRectangle";
    // Detect arrow lines via the lineCaps property
    var caps = ann.lineCaps || ann.lineCap;
    if (ann.type === "pspdfkit/shape/line" && caps && caps.end) {
      dvType = "AnnotationLineArrow";
    }
    var id = ann.id || uuid();
    // Ink annotations use lineWidth, shapes strokeWidth.
    var bw = ((ann.strokeWidth || ann.lineWidth || 1) / PPI).toFixed(6);
    var borderColor = ann.strokeColor ? toHex8(ann.strokeColor) : (ann.color ? toHex8(ann.color) : "#000000ff");
    var fillColor = ann.fillColor ? toHex8(ann.fillColor) : "transparent";
    var opacity = ann.opacity !== undefined ? ann.opacity : 1;
    var bbox = ann.bbox || [0, 0, 72, 72];
    var x = '';

    x += '    <Annotation Type="' + dvType + '" GUID="' + escapeXml(id) + '" Subject="' + dvType.replace("Annotation","") + '">\n';

    // Bounds-based (center coordinates in inches for backend)
    if (BOUNDS_TYPES.indexOf(dvType) !== -1) {
      var leftCenter = (bbox[0] / PPI) + (bbox[2] / PPI) / 2;
      var topCenter = (bbox[1] / PPI) + (bbox[3] / PPI) / 2;
      x += '      <Bounds Left="' + leftCenter.toFixed(6) + '" Top="' + topCenter.toFixed(6) +
           '" Width="' + (bbox[2] / PPI).toFixed(6) + '" Height="' + (bbox[3] / PPI).toFixed(6) + '" />\n';

      if (dvType === "AnnotationText" || dvType === "AnnotationStickyNote" || dvType === "AnnotationRubberStamp" || dvType === "AnnotationRedaction") {
        // Instant JSON v2 stores text as { format, value }.
        var text = ann.title || (ann.text && typeof ann.text === "object" ? ann.text.value : ann.text) || "";
        var font = ann.font || "Helvetica";
        var fontSize = ann.fontSize || 14;
        var icon = ann.icon || "COMMENT";
        var stampType = ann.stampType || ann.subject || "Custom";
        var overlayText = ann.overlayText || ann.title || ann.text || "";
        x += '      <Content Text="' + escapeXml(text) + '" Font="' + escapeXml(font) + '" FontSize="' + fontSize + '"';
        if (dvType === "AnnotationStickyNote") x += ' Icon="' + escapeXml(icon) + '"';
        if (dvType === "AnnotationRubberStamp") x += ' StampType="' + escapeXml(stampType) + '"';
        if (dvType === "AnnotationRedaction") x += ' OverlayText="' + escapeXml(overlayText) + '"';
        x += ' />\n';
        var fontColor = ann.fontColor ? toHex8(ann.fontColor) : "#000000ff";
        x += '      <Appearance BorderColor="' + borderColor + '" FillColor="' + fillColor +
             '" FontColor="' + fontColor + '" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';
      } else {
        x += '      <Appearance BorderColor="' + borderColor + '" FillColor="' + fillColor +
             '" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';
      }

    // Line (two endpoints)
    } else if (ann.type === "pspdfkit/shape/line") {
      var sp = ann.startPoint || [bbox[0], bbox[1]];
      var ep = ann.endPoint || [bbox[0] + bbox[2], bbox[1] + bbox[3]];
      x += '      <StartPoint Left="' + (sp[0] / PPI).toFixed(6) + '" Top="' + (sp[1] / PPI).toFixed(6) + '" />\n';
      x += '      <EndPoint Left="' + (ep[0] / PPI).toFixed(6) + '" Top="' + (ep[1] / PPI).toFixed(6) + '" />\n';
      x += '      <Appearance BorderColor="' + borderColor + '" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';

    // Ink / FreeHand (lines array)
    } else if (ann.type === "pspdfkit/ink") {
      // Instant JSON v2 stores ink as { points: [[...]], intensities: [[...]] }.
      var lines = (ann.lines && ann.lines.points) ? ann.lines.points : (ann.lines || [[[bbox[0], bbox[1]]]]);
      x += '      <Lines>\n';
      for (var l = 0; l < lines.length; l++) {
        x += '        <Line>\n';
        var stroke = lines[l];
        for (var i = 0; i < stroke.length; i++) {
          var pt = stroke[i];
          // Handle both [x,y] arrays and {x,y} objects
          var px = Array.isArray(pt) ? pt[0] : pt.x;
          var py = Array.isArray(pt) ? pt[1] : pt.y;
          x += '          <Point Left="' + (px / PPI).toFixed(6) + '" Top="' + (py / PPI).toFixed(6) + '" />\n';
        }
        x += '        </Line>\n';
      }
      x += '      </Lines>\n';
      x += '      <Appearance BorderColor="' + borderColor + '" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';

    } else if (TEXT_MARKUP_WS_TYPES.indexOf(ann.type) !== -1) {
      var markupRects = normalizeMarkupRects(ann.rects, bbox);
      var quadPoints = rectsToQuadPoints(markupRects);
      x += '      <QuadPoints>\n';
      for (var qi = 0; qi < quadPoints.length; qi++) {
        x += '        <Point Left="' + (quadPoints[qi][0] / PPI).toFixed(6) + '" Top="' + (quadPoints[qi][1] / PPI).toFixed(6) + '" />\n';
      }
      x += '      </QuadPoints>\n';
      x += '      <Appearance BorderColor="' + borderColor + '" FillColor="transparent" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';

    // Polygon / Polyline (points array)
    } else if (ann.points) {
      x += '      <Points>\n';
      var pts = ann.points;
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var px = Array.isArray(pt) ? pt[0] : pt.x;
        var py = Array.isArray(pt) ? pt[1] : pt.y;
        x += '        <Point Left="' + (px / PPI).toFixed(6) + '" Top="' + (py / PPI).toFixed(6) + '" />\n';
      }
      x += '      </Points>\n';
      x += '      <Appearance BorderColor="' + borderColor + '" FillColor="' + fillColor +
           '" BorderWidth="' + bw + '" Opacity="' + opacity + '" />\n';
    }

    x += '    </Annotation>\n';
    return x;
  }

  // =========================================================================
  //  Build from client-side tracked DV annotations (fallback)
  // =========================================================================

  // Detect DV annotation type from tracked properties
  function detectDvType(p) {
    var raw = (p.type || p.Type || p.annotType || p.AnnotationType || "").toString();
    if (raw.indexOf("RubberStamp") !== -1 || raw.indexOf("Stamp") !== -1) return "AnnotationRubberStamp";
    if (raw.indexOf("Redaction") !== -1) return "AnnotationRedaction";
    if (raw.indexOf("StickyNote") !== -1 || raw.indexOf("Note") !== -1) return "AnnotationStickyNote";
    if (raw.indexOf("FreeHand") !== -1 || raw.indexOf("Ink") !== -1) return "AnnotationFreeHand";
    if (raw.indexOf("ConnectedLines") !== -1) return "AnnotationConnectedLines";
    if (raw.indexOf("Polyline") !== -1) return "AnnotationPolyline";
    if (raw.indexOf("Polygon") !== -1) return "AnnotationPolygon";
    if (raw.indexOf("LineArrow") !== -1) return "AnnotationLineArrow";
    if (raw.indexOf("Line") !== -1) return "AnnotationLine";
    if (raw.indexOf("Ellipse") !== -1) return "AnnotationEllipse";
    if (raw.indexOf("Text") !== -1) return "AnnotationText";
    return "AnnotationRectangle";
  }

  function buildDvXmlFromTracked() {
    var ids = Object.keys(dvAnnotations);
    if (ids.length === 0) return null;
    var pages = {};
    ids.forEach(function (id) {
      var p = dvAnnotations[id]; var pi = flexPageIndex(p);
      if (!pages[pi]) pages[pi] = []; pages[pi].push({ id: id, props: p });
    });
    var xml = '<?xml version="1.0" encoding="utf-8"?>\n<GdPicture_Annotations Version="1.0">\n';
    Object.keys(pages).sort(function(a,b){return a-b;}).forEach(function(pi) {
      xml += '  <Page Index="' + pi + '">\n';
      pages[pi].forEach(function(item) { xml += trackedAnnotToXml(item.id, item.props); });
      xml += '  </Page>\n';
    });
    xml += '</GdPicture_Annotations>';
    return xml;
  }

  function trackedAnnotToXml(id, p) {
    var dvType = detectDvType(p);
    var border = toHex8(p.borderColor || p.BorderColor || p.strokeColor || "#000000");
    var fill = toHex8(p.backColor || p.BackColor || p.fillColor || "transparent");
    var bw = p.borderWidth || p.BorderWidth || p.strokeWidth || 0.04;
    var op = p.opacity !== undefined ? p.opacity : (p.Opacity !== undefined ? p.Opacity : 1);
    var x = '    <Annotation Type="' + dvType + '" GUID="' + escapeXml(id) + '" Subject="' + dvType.replace("Annotation", "") + '">\n';

    if (dvType === "AnnotationFreeHand") {
      var pts = p.points || p.Points || [];
      x += '      <Lines>\n        <Line>\n';
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var px = pt.x !== undefined ? pt.x : (pt.X !== undefined ? pt.X : (pt.Left || 0));
        var py = pt.y !== undefined ? pt.y : (pt.Y !== undefined ? pt.Y : (pt.Top || 0));
        x += '          <Point Left="' + px + '" Top="' + py + '" />\n';
      }
      x += '        </Line>\n      </Lines>\n';
      x += '      <Appearance BorderColor="' + border + '" BorderWidth="' + bw + '" Opacity="' + op + '" />\n';

    } else if (dvType === "AnnotationPolygon" || dvType === "AnnotationPolyline" || dvType === "AnnotationConnectedLines") {
      var pts = p.points || p.Points || [];
      x += '      <Points>\n';
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var px = pt.x !== undefined ? pt.x : (pt.X !== undefined ? pt.X : (pt.Left || 0));
        var py = pt.y !== undefined ? pt.y : (pt.Y !== undefined ? pt.Y : (pt.Top || 0));
        x += '        <Point Left="' + px + '" Top="' + py + '" />\n';
      }
      x += '      </Points>\n';
      x += '      <Appearance BorderColor="' + border + '" FillColor="' + fill + '" BorderWidth="' + bw + '" Opacity="' + op + '" />\n';

    } else if (dvType === "AnnotationLine" || dvType === "AnnotationLineArrow") {
      var x1 = p.startLeft || p.StartLeft || p.left || p.Left || 0;
      var y1 = p.startTop || p.StartTop || p.top || p.Top || 0;
      var x2 = p.endLeft || p.EndLeft || ((p.left || p.Left || 0) + (p.width || p.Width || 1));
      var y2 = p.endTop || p.EndTop || ((p.top || p.Top || 0) + (p.height || p.Height || 1));
      x += '      <StartPoint Left="' + x1 + '" Top="' + y1 + '" />\n';
      x += '      <EndPoint Left="' + x2 + '" Top="' + y2 + '" />\n';
      x += '      <Appearance BorderColor="' + border + '" BorderWidth="' + bw + '" Opacity="' + op + '" />\n';

    } else {
      // Bounds-based: Rectangle, Ellipse, Text, StickyNote (center coordinates)
      var left = p.left || p.Left || 0, topVal = p.top || p.Top || 0;
      var width = p.width || p.Width || 1, height = p.height || p.Height || 1;
      var leftCenter = left + width / 2;
      var topCenter = topVal + height / 2;
      x += '      <Bounds Left="' + leftCenter + '" Top="' + topCenter + '" Width="' + width + '" Height="' + height + '" />\n';

      if (dvType === "AnnotationText" || dvType === "AnnotationStickyNote" || dvType === "AnnotationRubberStamp" || dvType === "AnnotationRedaction") {
        var text = p.text || p.Text || "";
        var font = p.fontName || p.FontName || p.font || "Helvetica";
        var fontSize = p.fontSize || p.FontSize || 14;
        var stampType = p.stampType || p.StampType || p.typeName || p.TypeName || "Custom";
        var overlayText = p.overlayText || p.OverlayText || text;
        x += '      <Content Text="' + escapeXml(text) + '" Font="' + escapeXml(font) + '" FontSize="' + fontSize + '"';
        if (dvType === "AnnotationStickyNote") x += ' Icon="COMMENT"';
        if (dvType === "AnnotationRubberStamp") x += ' StampType="' + escapeXml(stampType) + '"';
        if (dvType === "AnnotationRedaction") x += ' OverlayText="' + escapeXml(overlayText) + '"';
        x += ' />\n';
        var fontColor = toHex8(p.foreColor || p.ForeColor || p.fontColor || "#000000");
        x += '      <Appearance BorderColor="' + border + '" FillColor="' + fill + '" FontColor="' + fontColor + '" BorderWidth="' + bw + '" Opacity="' + op + '" />\n';
      } else {
        x += '      <Appearance BorderColor="' + border + '" FillColor="' + fill + '" BorderWidth="' + bw + '" Opacity="' + op + '" />\n';
      }
    }

    x += '    </Annotation>\n';
    return x;
  }

  function buildInstantJSONFromTracked() {
    var annotations = [];
    Object.keys(dvAnnotations).forEach(function (id) {
      var p = dvAnnotations[id];
      var pi = flexPageIndex(p);
      var dvType = detectDvType(p);
      var wsType = DV_TO_WS[dvType] || "pspdfkit/shape/rectangle";
      var bw = (p.borderWidth || p.BorderWidth || p.strokeWidth || 0.04) * PPI;
      var op = p.opacity !== undefined ? p.opacity : (p.Opacity !== undefined ? p.Opacity : 1);
      var strokeColor = toHex6(p.borderColor || p.BorderColor || p.strokeColor) || "#000000";
      var fillHex = toHex6(p.backColor || p.BackColor || p.fillColor);

      var base = {
        v: 1, type: wsType, pageIndex: pi, opacity: op,
        strokeColor: strokeColor, strokeWidth: bw,
        blendMode: "normal", id: uuid(), creatorName: "DocuVieware", name: "",
      };

      if (BOUNDS_TYPES.indexOf(dvType) !== -1) {
        var wIn = p.width || p.Width || 1, hIn = p.height || p.Height || 1;
        base.bbox = [
          ((p.left || p.Left || 0) - wIn / 2) * PPI,
          ((p.top || p.Top || 0) - hIn / 2) * PPI,
          wIn * PPI, hIn * PPI
        ];
        base.fillColor = fillHex || null;
        if (dvType === "AnnotationText") {
          base.text = p.text || p.Text || "";
          base.font = p.fontName || p.FontName || p.font || "Helvetica";
          base.fontSize = p.fontSize || p.FontSize || 14;
          base.fontColor = toHex6(p.foreColor || p.ForeColor || p.fontColor) || "#000000";
          base.horizontalAlign = "left";
          base.verticalAlign = "top";
        }
        if (dvType === "AnnotationStickyNote") {
          base.text = p.text || p.Text || "";
          base.icon = "COMMENT";
        }
        if (dvType === "AnnotationRubberStamp") {
          base.title = p.text || p.Text || p.content || p.Content || "";
          base.stampType = p.stampType || p.StampType || p.typeName || p.TypeName || "Custom";
        }
        if (dvType === "AnnotationRedaction") {
          base.text = p.text || p.Text || p.overlayText || p.OverlayText || "";
          base.overlayText = p.overlayText || p.OverlayText || base.text;
        }

      } else if (dvType === "AnnotationLine" || dvType === "AnnotationLineArrow") {
        var x1 = (p.startLeft || p.StartLeft || p.left || p.Left || 0) * PPI;
        var y1 = (p.startTop || p.StartTop || p.top || p.Top || 0) * PPI;
        var w = p.width || p.Width || 1, h = p.height || p.Height || 1;
        var x2 = (p.endLeft || p.EndLeft || ((p.left || p.Left || 0) + w)) * PPI;
        var y2 = (p.endTop || p.EndTop || ((p.top || p.Top || 0) + h)) * PPI;
        base.bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(Math.abs(x2 - x1), 1), Math.max(Math.abs(y2 - y1), 1)];
        base.startPoint = [x1, y1];
        base.endPoint = [x2, y2];
        if (dvType === "AnnotationLineArrow") base.lineCaps = { end: "openArrow" };

      } else if (dvType === "AnnotationFreeHand") {
        var pts = p.points || p.Points || [];
        var converted = [], mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
        for (var i = 0; i < pts.length; i++) {
          var pt = pts[i];
          var px = (pt.x !== undefined ? pt.x : (pt.X !== undefined ? pt.X : (pt.Left || 0))) * PPI;
          var py = (pt.y !== undefined ? pt.y : (pt.Y !== undefined ? pt.Y : (pt.Top || 0))) * PPI;
          converted.push([px, py]);
          if (px < mnX) mnX = px; if (py < mnY) mnY = py;
          if (px > mxX) mxX = px; if (py > mxY) mxY = py;
        }
        base.bbox = converted.length > 0 ? [mnX, mnY, Math.max(mxX - mnX, 1), Math.max(mxY - mnY, 1)] : [0, 0, 72, 72];
        base.lines = [converted];
        base.isDrawnNaturally = false;

      } else {
        // Polygon, Polyline, ConnectedLines
        var pts = p.points || p.Points || [];
        var converted = [], mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
        for (var i = 0; i < pts.length; i++) {
          var pt = pts[i];
          var px = (pt.x !== undefined ? pt.x : (pt.X !== undefined ? pt.X : (pt.Left || 0))) * PPI;
          var py = (pt.y !== undefined ? pt.y : (pt.Y !== undefined ? pt.Y : (pt.Top || 0))) * PPI;
          converted.push([px, py]);
          if (px < mnX) mnX = px; if (py < mnY) mnY = py;
          if (px > mxX) mxX = px; if (py > mxY) mxY = py;
        }
        base.bbox = converted.length > 0 ? [mnX, mnY, Math.max(mxX - mnX, 1), Math.max(mxY - mnY, 1)] : [0, 0, 72, 72];
        base.points = converted;
        if (dvType === "AnnotationPolygon") base.fillColor = fillHex || null;
      }

      annotations.push(base);
    });
    return { format: "https://pspdfkit.com/instant-json/v1", pdfId: null, annotations: annotations };
  }

  function flexPageIndex(p) {
    if (p.pageIndex !== undefined) return p.pageIndex;
    if (p.pageNo !== undefined) return p.pageNo - 1;
    if (p.page !== undefined) return p.page - 1;
    return 0;
  }

  // =========================================================================
  //  DocuVieware Integration
  // =========================================================================

  function loadDocuVieware(theme) {
    $.ajax({
      url: BACKEND_URL + "/api/DocuVieware/GetDocuViewareControl",
      type: "POST", contentType: "application/json",
      data: JSON.stringify({
        SessionId: dvSessionId, ControlId: DV_CONTROL_ID,
        AllowPrint: true, EnablePrintButton: true, AllowUpload: true, EnableFileUploadButton: true,
        CollapsedSnapIn: true, ShowAnnotationsSnapIn: true, EnableRotateButtons: true,
        EnableZoomButtons: true, EnablePageViewButtons: true, EnableMouseModeButtons: true,
        EnableFormFieldsEdition: false, EnableAnnotationActionButtons: true,
        Theme: theme || currentTheme,
      }),
      timeout: 8000,
      success: function (data) { $("#dvContainer").html(data.htmlContent || data["htmlContent"]); waitForDocuViewareReady(); },
      error: function () { showDvError(); },
    });
  }

  function waitForDocuViewareReady() {
    if (typeof DocuViewareAPI !== "undefined" && DocuViewareAPI.IsInitialized(DV_CONTROL_ID)) {
      dvReady = true;
      registerDvTracking();
      updateButtons();
      showToast("DocuVieware ready", "success");
    } else {
      setTimeout(waitForDocuViewareReady, 50);
    }
  }

  /** Load sample document into all active viewers. Called by the Load button. */
  function loadDocument(serverRelativeUrl, displayName) {
    var absUrl = window.location.origin + serverRelativeUrl;

    if (dvReady) {
      DocuViewareAPI.LoadFromUri(DV_CONTROL_ID, absUrl,
        function () { showToast("Document loaded in DocuVieware", "success"); },
        function () { showToast("Failed to load in DocuVieware", "error"); }
      );
    }

    if (NV) {
      var container = document.getElementById("wsContainer");
      if (wsInstance) { try { NV.unload(container); } catch (_) {} wsInstance = null; wsReady = false; updateButtons(); }
      NV.load({
        container: container, document: absUrl,
        baseUrl: NUTRIENT_CDN,
        licenseKey: webSdkLicenseKey || undefined,
        theme: currentTheme === "dark" ? NV.Theme.DARK : NV.Theme.LIGHT
      }).then(function (inst) {
        wsInstance = inst; wsReady = true; updateButtons();
        registerWsTracking();
        showToast("Document loaded in WebSDK", "success");
      }).catch(function (err) { showToast("Failed to load in WebSDK: " + err.message, "error"); });
    }

    if (displayName) {
      var el = document.getElementById("loaded-filename");
      if (el) el.textContent = displayName;
    }
  }

  function loadDocumentFromFile(file) {
    if (!file) return;
    showToast("Uploading\u2026", "info");
    var form = new FormData();
    form.append("file", file);
    fetch("/api/document/upload", { method: "POST", body: form })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { showToast("Upload failed: " + data.error, "error"); return; }
        loadDocument(data.url, file.name);
      })
      .catch(function (err) { showToast("Upload failed: " + (err.message || err), "error"); });
  }

  function registerDvTracking() {
    DocuViewareAPI.RegisterOnAnnotationAdded(DV_CONTROL_ID, function(a){ refreshTrackedProps(a.id); scheduleComparisonRefresh(); });
    DocuViewareAPI.RegisterOnAnnotationEdited(DV_CONTROL_ID, function(a){ refreshTrackedProps(a.id); scheduleComparisonRefresh(); });
    DocuViewareAPI.RegisterOnAnnotationDeleted(DV_CONTROL_ID, function(id){ delete dvAnnotations[id]; scheduleComparisonRefresh(); });
  }

  function refreshTrackedProps(annotId) {
    try { var p = DocuViewareAPI.GetAnnotProperties(DV_CONTROL_ID, annotId); if (p && p !== 1) dvAnnotations[annotId] = p; } catch(_){}
  }

  /** Register WebSDK annotation event listeners for live comparison updates. */
  function registerWsTracking() {
    if (!wsInstance) return;
    wsInstance.addEventListener("annotations.create", function() { scheduleComparisonRefresh(); });
    wsInstance.addEventListener("annotations.update", function() { scheduleComparisonRefresh(); });
    wsInstance.addEventListener("annotations.delete", function() { scheduleComparisonRefresh(); });
  }

  function showDvError() {
    document.getElementById("dvContainer").innerHTML =
      '<div class="backend-error"><div class="error-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>' +
      '<h3>Backend Not Available</h3><p>DocuVieware needs the .NET backend of this demo.</p><code>' + BACKEND_URL + '</code></div>';
  }

  // =========================================================================
  //  Nutrient WebSDK Integration
  // =========================================================================

  function loadNutrientSDK() {
    if (NV) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script"); s.src = NUTRIENT_JS;
      s.onload = function(){ NV = window.NutrientViewer; resolve(); };
      s.onerror = function(){ reject(new Error("Failed to load Nutrient WebSDK.")); };
      document.head.appendChild(s);
    });
  }

  function loadWebSDKViewer() {
    // Just load the SDK, don't load a document yet — user clicks Load button
    loadNutrientSDK()
      .then(function () {
        wsReady = true; updateButtons();
        showToast("WebSDK ready", "success");
      })
      .catch(function(err){
        var container = document.getElementById("wsContainer");
        container.innerHTML = '<div class="backend-error"><div class="error-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><h3>WebSDK Failed</h3><p>' + err.message + '</p></div>';
      });
  }

  // =========================================================================
  //  Create annotations in WebSDK from InstantJSON data (all types)
  // =========================================================================

  function createAnnotationsInWebSDK(instantJSON) {
    var anns = (instantJSON.annotations || []).filter(function(a) {
      return SUPPORTED_WS_TYPES.indexOf(a.type) !== -1;
    });
    if (anns.length === 0) return Promise.resolve();

    var promises = anns.map(function (ann) {
      try { return createOneInWebSDK(ann); }
      catch (e) { console.warn("Could not create annotation:", ann.type, e); return Promise.resolve(); }
    });

    return Promise.all(promises).then(function () {
      showToast(anns.length + " annotation(s) transferred to WebSDK", "success");
      scheduleComparisonRefresh();
    });
  }

  function createOneInWebSDK(ann) {
    console.log("[createOneInWebSDK] Creating annotation type:", ann.type);
    var bbox = ann.bbox || [0, 0, 72, 72];
    var rect = new NV.Geometry.Rect({ left: bbox[0], top: bbox[1], width: bbox[2], height: bbox[3] });
    var stroke = nvColor(ann.strokeColor || ann.color || "#000000");
    var fill = ann.fillColor ? nvColor(ann.fillColor) : null;
    var sw = ann.strokeWidth || 1;
    var op = ann.opacity !== undefined ? ann.opacity : 1;
    var pi = ann.pageIndex || 0;
    var annotation;

    switch (ann.type) {
      case "pspdfkit/shape/rectangle":
        annotation = new NV.Annotations.RectangleAnnotation({
          pageIndex: pi, boundingBox: rect, strokeColor: stroke, strokeWidth: sw, opacity: op, fillColor: fill });
        break;

      case "pspdfkit/shape/ellipse":
        annotation = new NV.Annotations.EllipseAnnotation({
          pageIndex: pi, boundingBox: rect, strokeColor: stroke, strokeWidth: sw, opacity: op, fillColor: fill });
        break;

      case "pspdfkit/shape/line":
        var sp = ann.startPoint || [bbox[0], bbox[1]];
        var ep = ann.endPoint || [bbox[0] + bbox[2], bbox[1] + bbox[3]];
        annotation = new NV.Annotations.LineAnnotation({
          pageIndex: pi, boundingBox: rect, strokeColor: stroke, strokeWidth: sw, opacity: op,
          startPoint: new NV.Geometry.Point({ x: sp[0], y: sp[1] }),
          endPoint: new NV.Geometry.Point({ x: ep[0], y: ep[1] }),
          lineCaps: ann.lineCaps || null });
        break;

      case "pspdfkit/shape/polygon": {
        var points = (ann.points || []).map(function (p) {
          var px = Array.isArray(p) ? p[0] : p.x;
          var py = Array.isArray(p) ? p[1] : p.y;
          return new NV.Geometry.Point({ x: px, y: py });
        });
        annotation = new NV.Annotations.PolygonAnnotation({
          pageIndex: pi, boundingBox: rect, points: NV.Immutable.List(points),
          strokeColor: stroke, strokeWidth: sw, opacity: op, fillColor: fill });
        break;
      }

      case "pspdfkit/shape/polyline": {
        var points = (ann.points || []).map(function (p) {
          var px = Array.isArray(p) ? p[0] : p.x;
          var py = Array.isArray(p) ? p[1] : p.y;
          return new NV.Geometry.Point({ x: px, y: py });
        });
        annotation = new NV.Annotations.PolylineAnnotation({
          pageIndex: pi, boundingBox: rect, points: NV.Immutable.List(points),
          strokeColor: stroke, strokeWidth: sw, opacity: op });
        break;
      }

      case "pspdfkit/ink": {
        var lines = (ann.lines || []).map(function (stroke) {
          return NV.Immutable.List(stroke.map(function (p) {
            var px = Array.isArray(p) ? p[0] : p.x;
            var py = Array.isArray(p) ? p[1] : p.y;
            return new NV.Geometry.DrawingPoint({ x: px, y: py, intensity: 1 });
          }));
        });
        annotation = new NV.Annotations.InkAnnotation({
          pageIndex: pi, boundingBox: rect, lines: NV.Immutable.List(lines),
          strokeColor: stroke, lineWidth: sw, opacity: op, isDrawnNaturally: false });
        break;
      }

      case "pspdfkit/text":
        annotation = new NV.Annotations.TextAnnotation({
          pageIndex: pi, boundingBox: rect, text: { format: "plain", value: ann.text || "" },
          font: ann.font || "Helvetica", fontSize: ann.fontSize || 14,
          fontColor: nvColor(ann.fontColor || "#000000"),
          horizontalAlign: ann.horizontalAlign || "left", verticalAlign: ann.verticalAlign || "top" });
        break;

      case "pspdfkit/note":
        annotation = new NV.Annotations.NoteAnnotation({
          pageIndex: pi,
          boundingBox: rect,
          text: { format: "plain", value: ann.text || "" },
          icon: ann.icon || "COMMENT"
        });
        console.log("[createOneInWebSDK] Created NoteAnnotation:", annotation);
        break;

      case "pspdfkit/stamp": {
        var stampTitle = ann.title || ann.text || "";
        var stampType  = ann.stampType || "Custom";

        if (NV.Annotations && typeof NV.Annotations.StampAnnotation === "function") {
          annotation = new NV.Annotations.StampAnnotation({
            pageIndex: pi, boundingBox: rect, stampType: stampType,
            title: stampTitle, opacity: op, color: stroke
          });
          break;
        }

        if (typeof wsInstance.importInstantJSON === "function") {
          var stampPayload = {
            v: 1, type: "pspdfkit/stamp",
            stampType: stampType, title: stampTitle,
            pageIndex: ann.pageIndex || 0,
            bbox: ann.bbox || [0, 0, 72, 72],
            opacity: op,
            color: ann.strokeColor || "#000000"
          };
          return wsInstance.importInstantJSON({
            format: "https://pspdfkit.com/instant-json/v1", pdfId: null,
            annotations: [stampPayload]
          }).catch(function (err) {
            console.error("[AnnotConverter] Stamp importInstantJSON failed:", err);
            showToast("Stamp import failed: " + (err.message || err), "error");
          });
        }
        return Promise.resolve();
      }

      case "pspdfkit/redaction":
        if (typeof wsInstance.importInstantJSON === "function") {
          return wsInstance.importInstantJSON({ format: "https://pspdfkit.com/instant-json/v1", pdfId: null, annotations: [ann] });
        }
        return Promise.resolve();

      case "pspdfkit/markup/highlight":
      case "pspdfkit/markup/underline":
      case "pspdfkit/markup/strikeout":
      case "pspdfkit/markup/squiggly": {
        var rects = normalizeMarkupRects(ann.rects, bbox).map(function (r) {
          return new NV.Geometry.Rect({ left: r[0], top: r[1], width: r[2], height: r[3] });
        });
        var rectList = NV.Immutable && NV.Immutable.List ? NV.Immutable.List(rects) : rects;
        var ctor =
          ann.type === "pspdfkit/markup/highlight" ? NV.Annotations.HighlightAnnotation :
          ann.type === "pspdfkit/markup/underline" ? NV.Annotations.UnderlineAnnotation :
          ann.type === "pspdfkit/markup/strikeout" ? NV.Annotations.StrikeoutAnnotation :
          NV.Annotations.SquiggleAnnotation;

        if (typeof ctor === "function") {
          annotation = new ctor({
            pageIndex: pi,
            boundingBox: rect,
            rects: rectList,
            color: stroke,
            strokeColor: stroke,
            opacity: op,
          });
        } else if (typeof wsInstance.importInstantJSON === "function") {
          return wsInstance.importInstantJSON({ format: "https://pspdfkit.com/instant-json/v1", pdfId: null, annotations: [ann] });
        } else {
          return Promise.resolve();
        }
        break;
      }

      default:
        return Promise.resolve();
    }

    console.log("[createOneInWebSDK] Final annotation:", annotation ? annotation.constructor.name : "null");
    return wsInstance.create(annotation);
  }

  // =========================================================================
  //  XMP Format Parser
  // =========================================================================

  function xmpColorToHex(intColor) {
    var unsigned = intColor >>> 0;
    var hex = unsigned.toString(16).padStart(8, '0');
    return '#' + hex;
  }

  function xmpToGdPictureXml(xmpString) {
    var doc = new DOMParser().parseFromString(xmpString, "application/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("Invalid XMP XML: " + err.textContent.substring(0, 200));

    var annotations = [];
    var xmpAnnots = doc.querySelectorAll("Annotation");

    for (var a = 0; a < xmpAnnots.length; a++) {
      var ann = xmpAnnots[a];
      var xmpType = ann.querySelector("Type");
      var xmpId = ann.querySelector("ID");
      var xmpLeft = ann.querySelector("Left");
      var xmpTop = ann.querySelector("Top");
      var xmpWidth = ann.querySelector("Width");
      var xmpHeight = ann.querySelector("Height");
      var xmpStrokeColor = ann.querySelector("StrokeColor");
      var xmpFillColor = ann.querySelector("FillColor");
      var xmpBorderWidth = ann.querySelector("BorderWidth");
      var xmpOpacity = ann.querySelector("Opacity");

      var typeStr = xmpType ? xmpType.textContent : "AnnotationTypeRectangle";
      var dvType = typeStr.replace("Type", "");

      var left = xmpLeft ? parseFloat(xmpLeft.textContent) : 0;
      var top = xmpTop ? parseFloat(xmpTop.textContent) : 0;
      var width = xmpWidth ? parseFloat(xmpWidth.textContent) : 1;
      var height = xmpHeight ? parseFloat(xmpHeight.textContent) : 1;
      var id = xmpId ? xmpId.textContent : uuid();
      var strokeColorInt = xmpStrokeColor ? parseInt(xmpStrokeColor.textContent, 10) : -16777216;
      var fillColorInt = xmpFillColor ? parseInt(xmpFillColor.textContent, 10) : -1;
      var borderWidth = xmpBorderWidth ? parseFloat(xmpBorderWidth.textContent) : 0.04;
      var opacity = xmpOpacity ? parseFloat(xmpOpacity.textContent) : 1;

      var borderColor = xmpColorToHex(strokeColorInt);
      var fillColor = xmpColorToHex(fillColorInt);

      var subject = dvType.replace("Annotation", "");
      var xml = '    <Annotation Type="' + dvType + '" GUID="' + escapeXml(id) + '" Subject="' + subject + '">\n';
      xml += '      <Bounds Left="' + left.toFixed(6) + '" Top="' + top.toFixed(6) +
             '" Width="' + width.toFixed(6) + '" Height="' + height.toFixed(6) + '" />\n';
      xml += '      <Appearance BorderColor="' + borderColor + '" FillColor="' + fillColor +
             '" BorderWidth="' + borderWidth.toFixed(6) + '" Opacity="' + opacity + '" />\n';
      xml += '    </Annotation>\n';

      annotations.push(xml);
    }

    var gdxml = '<?xml version="1.0" encoding="utf-8"?>\n<GdPicture_Annotations Version="1.0">\n';
    gdxml += '  <Page Index="0">\n';
    gdxml += annotations.join('');
    gdxml += '  </Page>\n';
    gdxml += '</GdPicture_Annotations>';

    return gdxml;
  }

  // =========================================================================
  //  Transfer: DV → WebSDK
  // =========================================================================

  function transferToWebSDK() {
    if (!dvReady || !wsReady) { showToast("Both viewers must be ready", "error"); return; }
    clearWebSDKAnnotations().then(function () {
      return refreshStoredXmp()
        .then(function (xml) {
          if (!xml) throw new Error("No XML available");
          return createAnnotationsInWebSDK(xmlToInstantJSON(xml));
        })
        .catch(function () {
          return tryServerExport()
            .then(function (xml) { return createAnnotationsInWebSDK(xmlToInstantJSON(xml)); })
            .catch(function () {
              var ij = buildInstantJSONFromTracked();
              if (ij.annotations.length === 0) { showToast("No annotations found in DocuVieware.", "error"); return; }
              return createAnnotationsInWebSDK(ij);
            });
        });
    });
  }

  function tryServerExportXmp() {
    return new Promise(function (resolve, reject) {
      if (!dvReady) return reject("Not ready");
      var done = false;
      DocuViewareAPI.PostCustomServerAction(DV_CONTROL_ID, false, "export-annotations", "",
        function (r) {
          console.log("[AnnotConverter] tryServerExportXmp response:", r);
          if (done) return;
          done = true;
           if (typeof r === "string" && r.indexOf("<") !== -1) {
             console.log("[AnnotConverter] XMP received, length:", r.length);
             resolve(r);
          }
          else {
            console.log("[AnnotConverter] Invalid response, r:", r);
            reject("Invalid response");
          }
        });
      setTimeout(function () { if (!done) { done = true; console.log("[AnnotConverter] tryServerExportXmp timeout"); reject("Timeout"); } }, 3000);
    });
  }

  function refreshStoredXmp() {
    console.log("[AnnotConverter] refreshStoredXmp called");
    if (!dvReady) return Promise.resolve(null);
    return tryServerExportXmp().then(function (xmp) {
      dvAnnotationsXmp = xmp;
      console.log("[AnnotConverter] XMP stored, length:", xmp ? xmp.length : 0);
      return xmp;
    }).catch(function () {
      console.log("[AnnotConverter] XMP fetch failed");
      return null;
    });
  }

  function tryServerExport() {
    return new Promise(function (resolve, reject) {
      if (!dvReady) return reject("Not ready");
      var done = false;
      DocuViewareAPI.PostCustomServerAction(DV_CONTROL_ID, false, "export-annotations", "",
        function (r) { if (done) return; done = true;
          console.log("[AnnotConverter] Server response:", r);
          console.log("[AnnotConverter] Server result:", r && r.result);
          if (r && r.result && typeof r.result === "string" && r.result.indexOf("<") !== -1) {
            var result = r.result;
            if (result.indexOf("<?xpacket") !== -1) {
              try {
                console.log("[AnnotConverter] Detected XMP format, converting...");
                result = xmpToGdPictureXml(result);
                console.log("[AnnotConverter] XMP converted to GdPicture XML");
              } catch (e) {
                console.error("[AnnotConverter] XMP conversion failed:", e.message);
                reject("XMP conversion failed: " + e.message);
                return;
              }
            }
            resolve(result);
          }
          else { console.log("[AnnotConverter] Server export rejected - Invalid response"); reject("Invalid response"); } });
      setTimeout(function () { if (!done) { done = true; console.log("[AnnotConverter] Server export timed out"); reject("Timeout"); } }, 3000);
    });
  }

  function clearWebSDKAnnotations() {
    var pagePromises = [];
    for (var p = 0; p < wsInstance.totalPageCount; p++) {
      pagePromises.push(
        Promise.resolve(wsInstance.getAnnotations(p)).then(function (anns) {
          var arr = anns && anns.toArray ? anns.toArray() : (anns ? Array.from(anns) : []);
          return Promise.all(arr.map(function (a) { return wsInstance.delete(a.id); }));
        })
      );
    }
    return Promise.all(pagePromises);
  }

  // =========================================================================
  //  Transfer: WebSDK → DV
  // =========================================================================

  function transferToDocuVieware() {
    if (!dvReady || !wsReady) { showToast("Both viewers must be ready", "error"); return; }
    wsInstance.exportInstantJSON().then(function (ij) {
      var supported = (ij.annotations || []).filter(function (a) { return SUPPORTED_WS_TYPES.indexOf(a.type) !== -1; });
      if (supported.length === 0) { showToast("No supported annotations in WebSDK.", "error"); return; }
      var xml = instantJSONToXml({ annotations: supported });
      DocuViewareAPI.PostCustomServerAction(DV_CONTROL_ID, true, "clear-annotations", "",
        function () {
          DocuViewareAPI.PostCustomServerAction(DV_CONTROL_ID, true, "import-annotations", xml,
            function (r) {
              console.log("[AnnotConverter] Import result:", r && r.result);
              if (r && r.result) {
                try { var p = JSON.parse(r.result);
                  if (p.success) { showToast(p.imported + " annotation(s) imported", "success"); scheduleComparisonRefresh(); }
                  else if (p.error) showToast("Import error: " + p.error, "error");
                } catch(_) { showToast(supported.length + " annotation(s) transferred", "success"); }
              } else { showToast("No response from server", "error"); }
            });
        });
    }).catch(function(e){ showToast("Export failed: " + e.message, "error"); });
  }

  // =========================================================================
  //  Download & Comparison
  // =========================================================================

  function downloadXml() {
    if (!dvReady) { showToast("DocuVieware not ready", "error"); return; }
    tryServerExport().then(function(xml){ downloadFile(xml, "docuvieware-annotations.xml", "application/xml"); showToast("XML downloaded","success"); })
      .catch(function(){ var xml = buildDvXmlFromTracked();
        if (!xml) { showToast("No annotations tracked.", "error"); return; }
        downloadFile(xml, "docuvieware-annotations.xml", "application/xml"); showToast("XML downloaded","success"); });
  }

  function downloadInstantJSON() {
    if (!wsReady) { showToast("WebSDK not ready", "error"); return; }
    wsInstance.exportInstantJSON().then(function(j){
      downloadFile(JSON.stringify(j,null,2), "websdk-annotations.instantjson", "application/json"); showToast("InstantJSON downloaded","success");
    }).catch(function(e){ showToast("Export failed: "+e.message,"error"); });
  }

  // Debounced comparison refresh — updates live when overlay is visible
  var _refreshTimer = null;
  function scheduleComparisonRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(function () {
      _refreshTimer = null;
      refreshStoredXmp().then(function () {
        var overlay = document.getElementById("comparison-overlay");
        if (overlay && overlay.classList.contains("visible")) {
          refreshComparisonContent();
        }
      });
    }, 300);
  }

  function refreshComparisonContent() {
    var xmlEl = document.getElementById("code-xml"), jsonEl = document.getElementById("code-json");
    var jsonContent = '<span class="code-empty">No annotations in WebSDK.</span>';
    var jsonP = (wsReady && wsInstance) ? wsInstance.exportInstantJSON().catch(function(){ return null; }) : Promise.resolve(null);
    Promise.all([jsonP]).then(function(r){
      console.log("[AnnotConverter] dvAnnotationsXmp:", dvAnnotationsXmp ? dvAnnotationsXmp.substring(0, 100) + "..." : "null");
      var xmlContent = '<span class="code-empty">No annotations in DocuVieware.</span>';
      if (dvAnnotationsXmp) xmlContent = escapeHtml(dvAnnotationsXmp);
      if (r[0]) {
        var filtered = { format: r[0].format, annotations: (r[0].annotations||[]).filter(function(a){ return SUPPORTED_WS_TYPES.indexOf(a.type)!==-1; }) };
        jsonContent = escapeHtml(JSON.stringify(filtered, null, 2));
        var hidden = (r[0].annotations||[]).length - filtered.annotations.length;
        if (hidden > 0) jsonContent += '\n\n<span class="code-empty">(' + hidden + ' unsupported annotation(s) hidden)</span>';
      }
      if (xmlEl) xmlEl.innerHTML = xmlContent;
      if (jsonEl) jsonEl.innerHTML = jsonContent;
    });
  }

  function xmpIntToHex6(intColor, fallback) {
    var n = parseInt(intColor, 10);
    if (isNaN(n)) return fallback || "#000000";
    var unsigned = n >>> 0;
    var rgb = unsigned & 0x00ffffff;
    return "#" + rgb.toString(16).padStart(6, "0");
  }

  function xmpToInstantJSON(xmpString) {
    var XMP_TO_WS = {
      "AnnotationTypeRectangle": "pspdfkit/shape/rectangle",
      "AnnotationTypeEllipse": "pspdfkit/shape/ellipse",
      "AnnotationTypeLine": "pspdfkit/shape/line",
      "AnnotationTypeLineArrow": "pspdfkit/shape/line",
      "AnnotationTypePolygon": "pspdfkit/shape/polygon",
      "AnnotationTypeConnectedLines": "pspdfkit/shape/polyline",
      "AnnotationTypePolyline": "pspdfkit/shape/polyline",
      "AnnotationTypeFreeHand": "pspdfkit/ink",
      "AnnotationTypeText": "pspdfkit/text",
      "AnnotationTypeStickyNote": "pspdfkit/note"
    };

    function textOf(node, tag, def) {
      var n = node.querySelector(tag);
      if (!n || n.textContent === null || n.textContent === undefined || n.textContent === "") return def;
      return n.textContent;
    }

    function numOf(node, tag, def) {
      var v = parseFloat(textOf(node, tag, ""));
      return isNaN(v) ? def : v;
    }

    function pairToPoint(ptNode) {
      var x = parseFloat(textOf(ptNode, "X", textOf(ptNode, "Left", "0")));
      var y = parseFloat(textOf(ptNode, "Y", textOf(ptNode, "Top", "0")));
      if (isNaN(x)) x = 0;
      if (isNaN(y)) y = 0;
      return [x * PPI, y * PPI];
    }

    function computeBbox(points) {
      if (!points || points.length === 0) return [0, 0, 72, 72];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
      return [minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1)];
    }

    var doc = new DOMParser().parseFromString(xmpString, "application/xml");
    var err = doc.querySelector("parsererror");
    if (err) throw new Error("Invalid XMP XML: " + err.textContent.substring(0, 200));

    var nodes = doc.querySelectorAll("Annotation");
    var annotations = [];

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var xmpType = textOf(node, "Type", "AnnotationTypeRectangle");
      var wsType = XMP_TO_WS[xmpType];
      if (!wsType) continue;

      var id = textOf(node, "ID", uuid());
      var left = numOf(node, "Left", 0);
      var top = numOf(node, "Top", 0);
      var width = numOf(node, "Width", 1);
      var height = numOf(node, "Height", 1);
      var strokeWidthPt = numOf(node, "BorderWidth", 0.04) * PPI;
      var opacity = numOf(node, "Opacity", 1);
      var pageIndex = Math.max(0, Math.round(numOf(node, "PageIndex", numOf(node, "Page", 0))));

      var leftPt = (left - width / 2) * PPI;
      var topPt = (top - height / 2) * PPI;
      var widthPt = width * PPI;
      var heightPt = height * PPI;

      var ann = {
        v: 1,
        type: wsType,
        bbox: [leftPt, topPt, widthPt, heightPt],
        strokeColor: xmpIntToHex6(textOf(node, "StrokeColor", "-16777216"), "#000000"),
        fillColor: xmpIntToHex6(textOf(node, "FillColor", "-1"), "#ffffff"),
        strokeWidth: strokeWidthPt,
        opacity: opacity,
        pageIndex: pageIndex,
        id: id,
        name: ""
      };

      if (wsType === "pspdfkit/text") {
        ann.text = textOf(node, "Text", textOf(node, "Content", ""));
        ann.font = textOf(node, "Font", "Helvetica");
        ann.fontSize = numOf(node, "FontSize", 14);
        ann.fontColor = xmpIntToHex6(textOf(node, "FontColor", "-16777216"), "#000000");
        ann.horizontalAlign = "left";
        ann.verticalAlign = "top";
      } else if (wsType === "pspdfkit/note") {
        ann.text = textOf(node, "Text", textOf(node, "Content", ""));
        ann.icon = textOf(node, "Icon", "COMMENT");
      } else if (wsType === "pspdfkit/shape/line") {
        var sx = numOf(node, "StartX", numOf(node, "StartLeft", left - width / 2));
        var sy = numOf(node, "StartY", numOf(node, "StartTop", top - height / 2));
        var ex = numOf(node, "EndX", numOf(node, "EndLeft", left + width / 2));
        var ey = numOf(node, "EndY", numOf(node, "EndTop", top + height / 2));
        var x1 = sx * PPI, y1 = sy * PPI, x2 = ex * PPI, y2 = ey * PPI;
        ann.startPoint = [x1, y1];
        ann.endPoint = [x2, y2];
        ann.bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(Math.abs(x2 - x1), 1), Math.max(Math.abs(y2 - y1), 1)];
      } else if (wsType === "pspdfkit/shape/polygon" || wsType === "pspdfkit/shape/polyline") {
        var pointNodes = node.querySelectorAll("Points > Point");
        var points = [];
        for (var p = 0; p < pointNodes.length; p++) points.push(pairToPoint(pointNodes[p]));
        if (points.length > 0) {
          ann.points = points;
          ann.bbox = computeBbox(points);
        }
      } else if (wsType === "pspdfkit/ink") {
        var lineNodes = node.querySelectorAll("Lines > Line");
        var lines = [];
        for (var l = 0; l < lineNodes.length; l++) {
          var inkPointNodes = lineNodes[l].querySelectorAll("Point");
          var stroke = [];
          for (var q = 0; q < inkPointNodes.length; q++) stroke.push(pairToPoint(inkPointNodes[q]));
          if (stroke.length > 0) lines.push(stroke);
        }
        if (lines.length === 0) {
          var fallbackPoints = node.querySelectorAll("Points > Point");
          var oneLine = [];
          for (var fp = 0; fp < fallbackPoints.length; fp++) oneLine.push(pairToPoint(fallbackPoints[fp]));
          if (oneLine.length > 0) lines.push(oneLine);
        }
        if (lines.length > 0) {
          ann.lines = lines;
          ann.isDrawnNaturally = false;
          var allPoints = [];
          for (var li = 0; li < lines.length; li++) allPoints = allPoints.concat(lines[li]);
          ann.bbox = computeBbox(allPoints);
        }
      }

      annotations.push(ann);
    }

    return { format: "https://pspdfkit.com/instant-json/v1", pdfId: null, annotations: annotations };
  }

  function showComparison() {
    var overlay = document.getElementById("comparison-overlay");
    overlay.classList.add("visible");
    refreshStoredXmp().then(function () {
      refreshComparisonContent();
    });
  }

  function hideComparison() { document.getElementById("comparison-overlay").classList.remove("visible"); }

  function copyToClipboard(id, label) {
    var el = document.getElementById(id); if (!el) return;
    navigator.clipboard.writeText(el.textContent||"").then(function(){ showToast(label+" copied","success"); }).catch(function(){ showToast("Copy failed","error"); });
  }

  function escapeHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // =========================================================================
  //  Buttons, Theme, Init
  // =========================================================================

  function updateButtons() {
    var both = dvReady && wsReady;
    setDisabled("btn-to-websdk", !both); setDisabled("btn-to-dv", !both);
    setDisabled("btn-download-xml", !dvReady); setDisabled("btn-download-json", !wsReady);
    setDisabled("btn-show-xml", !dvReady && !wsReady); setDisabled("btn-show-json", !dvReady && !wsReady);

  }
  function setDisabled(id, d) { var e = document.getElementById(id); if (e) e.disabled = d; }

  function updateTheme(theme) {
    currentTheme = theme; try { localStorage.setItem("poc-theme", theme); } catch (_) {}
    document.documentElement.setAttribute("data-theme", theme);
    if (wsInstance && NV) { var t = theme === "dark" ? NV.Theme.DARK : NV.Theme.LIGHT;
      wsInstance.setViewState(function(vs){ return vs.set("theme", t); }); }
    if (dvReady) { dvReady = false; dvAnnotations = {}; dvAnnotationsXmp = null; updateButtons(); loadDocuVieware(theme); }
  }

  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "theme-change") updateTheme(e.data.theme);

  });

  // Use jQuery.ready() — unlike DOMContentLoaded, it fires even if DOM is already loaded
  // (critical when running inside an iframe where DOMContentLoaded may have already fired)
  $(function () {
    fetch("/api/config").then(function (r) { return r.json(); })
      .then(function (config) { webSdkLicenseKey = config.webSdkLicenseKey || ""; })
      .catch(function () {});
    loadDocuVieware(); loadWebSDKViewer();
    document.getElementById("btn-to-websdk").addEventListener("click", transferToWebSDK);
    document.getElementById("btn-to-dv").addEventListener("click", transferToDocuVieware);
    document.getElementById("btn-download-xml").addEventListener("click", downloadXml);
    document.getElementById("btn-download-json").addEventListener("click", downloadInstantJSON);
    document.getElementById("btn-show-xml").addEventListener("click", showComparison);
    document.getElementById("btn-show-json").addEventListener("click", showComparison);
    document.getElementById("btn-close-comparison").addEventListener("click", hideComparison);
    document.getElementById("btn-copy-xml").addEventListener("click", function(){ copyToClipboard("code-xml","XML"); });
    document.getElementById("btn-copy-json").addEventListener("click", function(){ copyToClipboard("code-json","JSON"); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape") hideComparison(); });

    document.getElementById("btn-load-sample").addEventListener("click", function () {
      loadDocument("/" + SAMPLE_PDF, SAMPLE_PDF);
    });
    document.getElementById("btn-load-doc").addEventListener("click", function () {
      document.getElementById("file-input").click();
    });
    document.getElementById("file-input").addEventListener("change", function () {
      if (this.files && this.files[0]) {
        loadDocumentFromFile(this.files[0]);
        this.value = "";
      }
    });

    updateButtons();
  });

})();
