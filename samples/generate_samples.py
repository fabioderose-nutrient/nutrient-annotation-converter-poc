"""Generate the fictitious sample PDF loaded by the "Load sample" button.

Output: AnnotationConverterApi/wwwroot/sample.pdf, a two-page site inspection
report with a simple floor plan to annotate. Every name and value is invented.

Usage (from the repository root):
    python -m venv .venv-samples
    .venv-samples/bin/pip install reportlab
    .venv-samples/bin/python samples/generate_samples.py
"""

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "AnnotationConverterApi" / "wwwroot" / "sample.pdf"


def header(c, title, page, pages):
    width, height = letter
    c.setFillColorRGB(0.12, 0.16, 0.23)
    c.rect(0, height - 0.9 * inch, width, 0.9 * inch, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, height - 0.58 * inch, title)
    c.setFont("Helvetica", 9)
    c.drawRightString(width - 0.75 * inch, height - 0.58 * inch, "Example Facilities Ltd.")
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.setFont("Helvetica", 8)
    c.drawString(0.75 * inch, 0.5 * inch, "Fictitious sample document generated for a Nutrient demo.")
    c.drawRightString(width - 0.75 * inch, 0.5 * inch, f"Page {page} of {pages}")
    c.setFillColorRGB(0.1, 0.1, 0.1)


def floor_plan(c):
    header(c, "Site Inspection Report", 1, 2)
    c.setFont("Helvetica", 10.5)
    y = 9.7 * inch
    for line in [
        "Site: Warehouse B, ground floor        Inspection date: 12 March 2026",
        "Inspector: Facilities Team             Reference: INSP-2026-044",
    ]:
        c.drawString(0.75 * inch, y, line)
        y -= 0.22 * inch

    # Floor plan: outer walls, rooms, doors and labels.
    left, bottom, width, height = 0.9 * inch, 3.4 * inch, 6.7 * inch, 5.4 * inch
    c.setLineWidth(3)
    c.rect(left, bottom, width, height)
    c.setLineWidth(1.5)
    c.line(left + 2.4 * inch, bottom, left + 2.4 * inch, bottom + height)
    c.line(left, bottom + 2.6 * inch, left + 2.4 * inch, bottom + 2.6 * inch)
    c.line(left + 2.4 * inch, bottom + 3.6 * inch, left + width, bottom + 3.6 * inch)
    c.line(left + 4.6 * inch, bottom + 3.6 * inch, left + 4.6 * inch, bottom + height)
    c.setFont("Helvetica-Bold", 11)
    for label, x, yy in [
        ("Office", 0.7, 4.0), ("Storage", 0.7, 1.3), ("Loading area", 3.7, 1.7),
        ("Break room", 2.9, 4.5), ("Server room", 5.0, 4.5),
    ]:
        c.drawString(left + x * inch, bottom + yy * inch, label)
    c.setFont("Helvetica", 8)
    c.drawString(left, bottom - 0.25 * inch, "Scale 1:200. Dimensions in metres.")

    c.setFont("Helvetica-Bold", 12)
    c.drawString(0.75 * inch, 2.7 * inch, "Findings")
    c.setFont("Helvetica", 10.5)
    y = 2.45 * inch
    for line in [
        "1. Fire extinguisher missing in the storage room.",
        "2. Emergency exit sign not lit in the loading area.",
        "3. Cable trays in the server room need labelling.",
    ]:
        c.drawString(0.9 * inch, y, line)
        y -= 0.22 * inch
    c.showPage()


def actions(c):
    header(c, "Corrective Actions", 2, 2)
    rows = [
        ("Finding", "Action", "Owner", "Due"),
        ("1", "Install a 6 kg extinguisher", "Facilities", "20 Mar"),
        ("2", "Replace the exit sign battery", "Maintenance", "15 Mar"),
        ("3", "Label all cable trays", "IT", "31 Mar"),
    ]
    columns = [0.9, 1.9, 4.6, 6.0]
    y = 9.4 * inch
    for index, row in enumerate(rows):
        c.setFont("Helvetica-Bold" if index == 0 else "Helvetica", 10.5)
        for x, text in zip(columns, row):
            c.drawString(x * inch, y, text)
        c.setLineWidth(0.5)
        c.line(0.8 * inch, y - 0.1 * inch, 7.6 * inch, y - 0.1 * inch)
        y -= 0.35 * inch
    c.setFont("Helvetica", 10.5)
    c.drawString(0.9 * inch, y - 0.3 * inch, "Sign-off:")
    c.line(1.7 * inch, y - 0.32 * inch, 4.5 * inch, y - 0.32 * inch)
    c.showPage()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=letter)
    c.setTitle("Site Inspection Report")
    c.setAuthor("Example Facilities Ltd.")
    floor_plan(c)
    actions(c)
    c.save()
    print(f"{OUT.relative_to(ROOT)}  {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
