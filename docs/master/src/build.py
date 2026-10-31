"""Build the FinSight master document as print HTML (-> PDF) and DOCX.

  python3 docs/master/src/build.py html   # writes build/master.html + build/svg/*.svg
  node    docs/master/src/render.mjs       # SVG -> PNG, HTML -> PDF
  python3 docs/master/src/build.py docx   # writes the .docx (needs the PNGs)

Both outputs read the same blocks from content.py, so they stay identical.
"""
import base64
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import content  # noqa: E402
import diagrams  # noqa: E402

ROOT = os.path.dirname(HERE)                       # docs/master
REPO = os.path.dirname(os.path.dirname(ROOT))
BUILD = os.path.join(ROOT, "build")
SHOTS = os.path.join(ROOT, "shots")
LOGO = os.path.join(REPO, "public", "icon.png")
OUT_NAME = "FinSight-Master-Document"

STATUS_COLOURS = {"core": ("#15803d", "#e6f6ec"), "partial": ("#b7791f", "#fdf3e1"),
                  "scoped": ("#0f766e", "#e3f5f2"), "na": ("#475569", "#f1f3f7")}


def number_shots(doc):
    """Screens get their own numbering ("Screen N") so diagram figure numbers stay stable."""
    n = 0
    out = []
    for b in doc:
        if b[0] == "shot":
            n += 1
            out.append(("shot", b[1], f"Screen {n} — {b[2]}", b[3] if len(b) > 3 else "wide"))
        else:
            out.append(b)
    return out


DOC = number_shots(content.DOC)


# ------------------------------------------------------------------ HTML

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\s][^*]*)\*(?!\w)", r"<em>\1</em>", s)
    return s


def slug(t):
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


CSS = r"""
@page { size: A4; margin: 20mm 17mm 18mm 17mm; }
@page cover { margin: 0; }
:root { --v:#6d4fe0; --vd:#4b32b8; --vw:#f3f0fe; --a:#b7791f; --aw:#fdf3e1; --ink:#16141f; --ink2:#3b384b; --mut:#6b6880; --line:#e3e0ec; --code:#f4f2f9; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Inter, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: var(--ink); margin: 0; }
.cover { page: cover; height: 297mm; width: 210mm; position: relative; overflow: hidden; color: #fff; break-after: page;
  background: radial-gradient(120% 80% at 85% 10%, #8a6cf5 0%, rgba(138,108,245,0) 55%), radial-gradient(90% 70% at 0% 100%, #b7791f 0%, rgba(183,121,31,0) 50%), linear-gradient(160deg, #1b1430 0%, #0d0b16 100%); }
.cover .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); background-size: 14mm 14mm; }
.cover .inner { position: absolute; left: 20mm; right: 20mm; top: 26mm; bottom: 22mm; display: flex; flex-direction: column; }
.cover .logo { display: flex; align-items: center; gap: 4mm; font-family: 'JetBrains Mono', Menlo, monospace; letter-spacing: .18em; font-size: 10pt; font-weight: 700; }
.cover .logo img { width: 15mm; height: 15mm; border-radius: 3.5mm; box-shadow: 0 0 0 1px rgba(255,255,255,.18); }
.cover .eyebrow { margin-top: 40mm; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 9pt; letter-spacing: .28em; color: #c9b8ff; text-transform: uppercase; }
.cover h1 { font-size: 44pt; line-height: 1.02; margin: 5mm 0 4mm; letter-spacing: -.02em; font-weight: 800; }
.cover .sub { font-size: 17pt; font-weight: 600; color: #e7e0ff; }
.cover .tag { margin-top: 7mm; max-width: 140mm; font-size: 11pt; color: #cfc8e6; line-height: 1.55; }
.cover .shot { margin-top: 12mm; border-radius: 3mm; overflow: hidden; box-shadow: 0 10mm 24mm rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12); }
.cover .shot img { width: 100%; display: block; }
.cover .meta { margin-top: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; border-top: 1px solid rgba(255,255,255,.18); padding-top: 5mm; font-size: 8.5pt; }
.cover .meta b { display: block; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 7pt; letter-spacing: .16em; color: #b9adde; font-weight: 600; text-transform: uppercase; margin-bottom: 1mm; }
.toc { break-after: page; }
.toc h1 { border: 0; }
.toc ol { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 10mm; }
.toc li { padding: 1.6mm 0; border-bottom: 1px dotted var(--line); font-size: 10pt; break-inside: avoid; }
.toc li a { color: var(--ink); text-decoration: none; }
.toc li .n { display: inline-block; min-width: 9mm; color: var(--v); font-weight: 700; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 9pt; }
h1 { font-size: 21pt; line-height: 1.15; margin: 0 0 5mm; padding-bottom: 3mm; border-bottom: 2.5px solid var(--v); letter-spacing: -.01em; break-after: avoid; }
h1 .num { color: var(--v); }
h2 { font-size: 13.5pt; margin: 7mm 0 2.5mm; color: var(--vd); break-after: avoid; }
h3 { font-size: 11pt; margin: 5mm 0 2mm; color: var(--ink); break-after: avoid; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3.5mm; padding-left: 6mm; }
li { margin: 0 0 1.2mm; }
code { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 8.4pt; background: var(--code); border: 1px solid #e8e4f3; border-radius: 3px; padding: 0 1.2mm; color: #3a2a8a; word-break: break-word; }
pre { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 8.4pt; background: #15121f; color: #e9e4ff; padding: 4mm; border-radius: 2.5mm; white-space: pre-wrap; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 4.5mm; font-size: 8.8pt; }
thead { display: table-header-group; }
th { background: #2a2140; color: #fff; text-align: left; font-weight: 600; padding: 2mm 2.5mm; font-size: 8.4pt; letter-spacing: .02em; }
th:first-child { border-top-left-radius: 2mm; } th:last-child { border-top-right-radius: 2mm; }
td { padding: 1.8mm 2.5mm; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:nth-child(even) td { background: #faf9fd; }
tr { break-inside: avoid; }
figure { margin: 3mm 0 6mm; break-inside: avoid; text-align: center; }
figure.diag svg { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 3mm; }
figure.shot img { width: 100%; border-radius: 2.5mm; box-shadow: 0 1.5mm 5mm rgba(22,20,31,.18), 0 0 0 1px rgba(22,20,31,.12); }
figure.shot.narrow img { width: 60%; }
td.id { white-space: nowrap; }
figcaption { font-size: 8.4pt; color: var(--mut); margin-top: 2.2mm; text-align: left; }
figcaption .src { display: inline-block; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; padding: .3mm 1.6mm; border-radius: 1.5mm; margin-right: 1.5mm; vertical-align: 1px; }
.src.live { background: #e6f6ec; color: #15803d; } .src.guide { background: #f3f0fe; color: #4b32b8; }
.callout { border-left: 4px solid var(--v); background: var(--vw); padding: 3mm 4mm; border-radius: 0 2.5mm 2.5mm 0; margin: 2mm 0 4.5mm; break-inside: avoid; }
.callout.warn { border-color: var(--a); background: var(--aw); }
.callout .t { font-weight: 700; margin-bottom: 1mm; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(26mm, 1fr)); gap: 3mm; margin: 2mm 0 5mm; }
.kpi { border: 1px solid var(--line); border-radius: 2.5mm; padding: 3mm; background: linear-gradient(180deg, #fff, #f7f5fd); }
.kpi b { display: block; font-size: 17pt; color: var(--v); line-height: 1.1; }
.kpi span { font-size: 8pt; color: var(--mut); }
.break { break-after: page; }
.domain { border: 1px solid var(--line); border-radius: 3mm; margin: 0 0 4mm; break-inside: avoid; overflow: hidden; }
.domain .hd { display: flex; align-items: center; gap: 3mm; padding: 2.4mm 3.5mm; background: #faf9fd; border-bottom: 1px solid var(--line); }
.domain .no { font-family: 'JetBrains Mono', Menlo, monospace; font-weight: 700; color: #fff; background: var(--v); border-radius: 1.6mm; padding: .6mm 1.8mm; font-size: 8.5pt; }
.domain .nm { font-weight: 700; font-size: 10.5pt; flex: 1; }
.domain .st { font-size: 7.6pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: .8mm 2.2mm; border-radius: 3mm; }
.domain .bd { display: grid; grid-template-columns: 1.65fr 1fr; gap: 0; }
.domain .bd > div { padding: 2.5mm 3.5mm 1mm; font-size: 8.8pt; }
.domain .bd > div + div { border-left: 1px solid var(--line); background: #fffdf8; }
.domain .lb { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 6.8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--mut); margin-bottom: 1mm; }
.domain ul { padding-left: 4.5mm; margin-bottom: 2mm; }
"""


def render_html():
    os.makedirs(os.path.join(BUILD, "svg"), exist_ok=True)
    for k, fn in diagrams.ALL.items():
        with open(os.path.join(BUILD, "svg", k + ".svg"), "w") as f:
            f.write(fn())
    m = content.META
    h1s = [b[1] for b in DOC if b[0] == "h1" and b[1] != "Document control"]
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(m['title'])} — {html.escape(m['subtitle'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>
<section class="cover"><div class="grid"></div><div class="inner">
<div class="logo"><img src="{data_uri(LOGO)}" alt="">FINSIGHT // TERMINAL</div>
<div class="eyebrow">{html.escape(m['subtitle'])}</div>
<h1>FinSight Terminal<br>&amp; Kestrel Agent</h1>
<div class="sub">Product · Architecture · Agent · Security · Quality</div>
<div class="tag">{html.escape(m['tagline'])}</div>
<div class="shot"><img src="{data_uri(os.path.join(SHOTS, 'terminal-detail.png'))}" alt=""></div>
<div class="meta"><div><b>Version</b>{m['version']}</div><div><b>Date</b>{m['date']}</div><div><b>Owner</b>{m['owner']}</div><div><b>Status</b>{html.escape(m['status'])}</div></div>
</div></section>
<section class="toc"><h1>Contents</h1><ol>"""]
    for t in ["Document control"] + h1s:
        mt = re.match(r"^(\d+)\.\s+(.*)$", t)
        n, label = (mt.group(1), mt.group(2)) if mt else ("", t)
        parts.append(f'<li><a href="#{slug(t)}"><span class="n">{n}</span>{inline(label)}</a></li>')
    parts.append("</ol></section>")
    for b in DOC:
        k = b[0]
        if k == "h1":
            mt = re.match(r"^(\d+\.)\s+(.*)$", b[1])
            t = f'<span class="num">{mt.group(1)}</span> {inline(mt.group(2))}' if mt else inline(b[1])
            parts.append(f'<h1 id="{slug(b[1])}">{t}</h1>')
        elif k in ("h2", "h3"):
            parts.append(f"<{k}>{inline(b[1])}</{k}>")
        elif k == "p":
            parts.append(f"<p>{inline(b[1])}</p>")
        elif k in ("ul", "ol"):
            parts.append(f"<{k}>" + "".join(f"<li>{inline(i)}</li>" for i in b[1]) + f"</{k}>")
        elif k == "table":
            head = "".join(f"<th>{inline(h)}</th>" for h in b[1])
            idcol = all(len(r[0]) <= 9 for r in b[2])
            rows = "".join("<tr>" + "".join(("<td class='id'>" if (i == 0 and idcol) else "<td>") + inline(c) + "</td>" for i, c in enumerate(r)) + "</tr>" for r in b[2])
            parts.append(f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>")
        elif k == "fig":
            parts.append(f'<figure class="diag">{diagrams.ALL[b[1]]()}<figcaption>{inline(b[2])}</figcaption></figure>')
        elif k == "shot":
            live = not b[1].startswith("g-")
            tag = '<span class="src live">Live capture</span>' if live else '<span class="src guide">Guide reconstruction</span>'
            parts.append(f'<figure class="shot {b[3]}"><img src="{data_uri(os.path.join(SHOTS, b[1]))}" alt=""><figcaption>{tag}{inline(b[2])}</figcaption></figure>')
        elif k == "callout":
            parts.append(f'<div class="callout {b[1]}"><div class="t">{inline(b[2])}</div>{inline(b[3])}</div>')
        elif k == "code":
            parts.append(f"<pre>{html.escape(b[1])}</pre>")
        elif k == "kpis":
            parts.append('<div class="kpis">' + "".join(f"<div class=\"kpi\"><b>{html.escape(v)}</b><span>{html.escape(l)}</span></div>" for v, l in b[1]) + "</div>")
        elif k == "break":
            parts.append('<div class="break"></div>')
        elif k == "domain":
            _, no, name, label, status, how, gaps = b
            c, bg = STATUS_COLOURS[status]
            hw = "".join(f"<li>{inline(x)}</li>" for x in how)
            gp = "".join(f"<li>{inline(x)}</li>" for x in gaps) or "<li>None open.</li>"
            parts.append(f'<div class="domain"><div class="hd"><span class="no">{no:02d}</span><span class="nm">{inline(name)}</span>'
                         f'<span class="st" style="color:{c};background:{bg}">{label}</span></div>'
                         f'<div class="bd"><div><div class="lb">How FinSight addresses it</div><ul>{hw}</ul></div>'
                         f'<div><div class="lb">Gaps and decisions</div><ul>{gp}</ul></div></div></div>')
        else:
            raise ValueError(k)
    parts.append("</body></html>")
    with open(os.path.join(BUILD, "master.html"), "w") as f:
        f.write("".join(parts))
    print("html ok", len(DOC), "blocks")


# ------------------------------------------------------------------ DOCX

def render_docx():
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Emu, Pt, RGBColor

    V, VD, INK, MUT, A = RGBColor(0x6D, 0x4F, 0xE0), RGBColor(0x4B, 0x32, 0xB8), RGBColor(0x16, 0x14, 0x1F), RGBColor(0x6B, 0x68, 0x80), RGBColor(0xB7, 0x79, 0x1F)
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.8)
    sec.top_margin, sec.bottom_margin = Cm(2), Cm(1.8)
    WIDTH = Cm(17.4)

    st = doc.styles
    st["Normal"].font.name = "Calibri"
    st["Normal"].font.size = Pt(10)
    st["Normal"].paragraph_format.space_after = Pt(5)
    st["Normal"].paragraph_format.line_spacing = 1.15
    for name, size, colour in [("Heading 1", 19, INK), ("Heading 2", 13, VD), ("Heading 3", 11, INK)]:
        s = st[name]
        s.font.name, s.font.size, s.font.bold, s.font.color.rgb = "Calibri", Pt(size), True, colour
        s.paragraph_format.space_before = Pt(14 if name != "Heading 1" else 0)
        s.paragraph_format.space_after = Pt(6)
        s.paragraph_format.keep_with_next = True

    def shade(cell, hex_fill):
        tcPr = cell._tc.get_or_add_tcPr()
        sh = OxmlElement("w:shd")
        sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), hex_fill)
        tcPr.append(sh)

    def borders(table, colour="E3E0EC", inside=True):
        tblPr = table._tbl.tblPr
        b = OxmlElement("w:tblBorders")
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            e = OxmlElement(f"w:{edge}")
            on = inside or edge in ("top", "left", "bottom", "right")
            e.set(qn("w:val"), "single" if on else "nil"); e.set(qn("w:sz"), "4"); e.set(qn("w:color"), colour)
            b.append(e)
        tblPr.append(b)

    def cell_margins(table, top=60, side=90):
        tblPr = table._tbl.tblPr
        m = OxmlElement("w:tblCellMar")
        for edge, v in (("top", top), ("bottom", top), ("left", side), ("right", side)):
            e = OxmlElement(f"w:{edge}"); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); m.append(e)
        tblPr.append(m)

    def runs(par, text, size=None, colour=None, bold=False):
        """Add inline-marked text: **bold**, `code`, *italic*."""
        for tok in re.split(r"(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])\*[^*\s][^*]*\*(?!\w))", text):
            if not tok:
                continue
            if tok.startswith("**"):
                r = par.add_run(tok[2:-2]); r.bold = True
            elif tok.startswith("`"):
                r = par.add_run(tok[1:-1]); r.font.name = "Consolas"; r.font.color.rgb = RGBColor(0x3A, 0x2A, 0x8A)
                r._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")
                if size: r.font.size = Pt(size - 0.8)
                else: r.font.size = Pt(9)
                continue
            elif tok.startswith("*"):
                r = par.add_run(tok[1:-1]); r.italic = True
            else:
                r = par.add_run(tok)
            if bold: r.bold = True
            if size: r.font.size = Pt(size)
            if colour: r.font.color.rgb = colour
        return par

    def field(par, instr):
        r = par.add_run()
        a = OxmlElement("w:fldChar"); a.set(qn("w:fldCharType"), "begin"); r._r.append(a)
        t = OxmlElement("w:instrText"); t.set(qn("xml:space"), "preserve"); t.text = instr; r._r.append(t)
        c = OxmlElement("w:fldChar"); c.set(qn("w:fldCharType"), "separate"); r._r.append(c)
        r2 = par.add_run("Right-click → Update field" if "TOC" in instr else "1")
        d = OxmlElement("w:fldChar"); d.set(qn("w:fldCharType"), "end"); r2._r.append(d)

    def table(headers, rows, widths=None):
        if widths is None:
            lens = [max([len(headers[i])] + [len(str(r[i])) for r in rows]) for i in range(len(headers))]
            wts = [min(max(L, 6), 70) for L in lens]
            # Short code columns (IDs, levels) get a fixed width that fits their text.
            fixed = {i: Cm(0.22 * max(lens[i], 4) + 0.5) for i in range(len(lens)) if lens[i] <= 12}
            free = Cm(17.4) - sum(fixed.values())
            rest = sum(w for i, w in enumerate(wts) if i not in fixed) or 1
            widths = [fixed.get(i, Emu(int(free * w / rest))) for i, w in enumerate(wts)]
        t = doc.add_table(rows=1, cols=len(headers))
        t.autofit = False
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        borders(t); cell_margins(t)
        for i, h in enumerate(headers):
            c = t.rows[0].cells[i]; shade(c, "2A2140")
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0)
            runs(p, h, 8.5, RGBColor(0xFF, 0xFF, 0xFF), True)
        trPr = t.rows[0]._tr.get_or_add_trPr(); hh = OxmlElement("w:tblHeader"); hh.set(qn("w:val"), "true"); trPr.append(hh)
        for ri, r in enumerate(rows):
            cells = t.add_row().cells
            for i, v in enumerate(r):
                p = cells[i].paragraphs[0]; p.paragraph_format.space_after = Pt(0)
                runs(p, v, 8.8)
                if ri % 2: shade(cells[i], "FAF9FD")
        if widths:
            # Word reads the cell widths, LibreOffice the grid: set both.
            for gc, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), widths):
                gc.set(qn("w:w"), str(int(w.twips)))
            for row in t.rows:
                for i, w in enumerate(widths):
                    row.cells[i].width = w
        doc.add_paragraph().paragraph_format.space_after = Pt(2)
        return t

    # ---- cover (its own section, no header/footer)
    cover = doc.add_paragraph(); cover.alignment = WD_ALIGN_PARAGRAPH.LEFT
    cover.add_run().add_picture(LOGO, width=Cm(2.2))
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(36)
    runs(p, content.META["subtitle"].upper(), 9, V, True)
    p = doc.add_paragraph(); runs(p, "FinSight Terminal & Kestrel Agent", 34, INK, True); p.paragraph_format.space_after = Pt(2)
    p = doc.add_paragraph(); runs(p, "Product · Architecture · Agent · Security · Quality", 14, VD, True)
    p = doc.add_paragraph(); runs(p, content.META["tagline"], 11, MUT)
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(10)
    p.add_run().add_picture(os.path.join(SHOTS, "terminal-detail.png"), width=WIDTH)
    m = content.META
    t = doc.add_table(rows=2, cols=4); borders(t, "E3E0EC", inside=False); cell_margins(t, 80, 110)
    for i, (k, v) in enumerate([("VERSION", m["version"]), ("DATE", m["date"]), ("OWNER", m["owner"]), ("STATUS", m["status"])]):
        runs(t.rows[0].cells[i].paragraphs[0], k, 7.5, MUT, True)
        runs(t.rows[1].cells[i].paragraphs[0], v, 9.5, INK)
    sec.different_first_page_header_footer = True
    hp = sec.header.paragraphs[0]; runs(hp, "FinSight Terminal — Master Product & Engineering Document", 8, MUT)
    fp = sec.footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    runs(fp, f"v{m['version']} · {m['date']} · page ", 8, MUT); field(fp, "PAGE")
    for r in fp.runs: r.font.size = Pt(8); r.font.color.rgb = MUT
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---- contents (static list of sections, same as the PDF)
    doc.add_heading("Contents", 1)
    for b in DOC:
        if b[0] == "h1":
            mt = re.match(r"^(\d+)\.\s+(.*)$", b[1])
            p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.tab_stops.add_tab_stop(Cm(1.1))
            if mt:
                runs(p, mt.group(1), 10, V, True); runs(p, "\t" + mt.group(2), 10.5)
            else:
                runs(p, "\t" + b[1], 10.5)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    png = os.path.join(BUILD, "png")
    for b in DOC:
        k = b[0]
        if k in ("h1", "h2", "h3"):
            doc.add_heading(b[1].replace("**", "").replace("`", ""), int(k[1]))
        elif k == "p":
            runs(doc.add_paragraph(), b[1])
        elif k in ("ul", "ol"):
            for n, it in enumerate(b[1], 1):
                if k == "ul":
                    p = doc.add_paragraph(style="List Bullet")
                    runs(p, it)
                else:
                    # Manual numbers: Word's List Number continues across the whole document.
                    p = doc.add_paragraph()
                    p.paragraph_format.left_indent = Cm(0.7); p.paragraph_format.first_line_indent = Cm(-0.5)
                    runs(p, f"{n}.", None, V, True); runs(p, "  " + it)
                p.paragraph_format.space_after = Pt(2)
        elif k == "table":
            table(b[1], b[2])
        elif k == "fig":
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.keep_with_next = True
            p.add_run().add_picture(os.path.join(png, b[1] + ".png"), width=WIDTH)
            c = doc.add_paragraph(); runs(c, b[2], 8.5, MUT); c.paragraph_format.space_after = Pt(10)
        elif k == "shot":
            p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.keep_with_next = True
            p.add_run().add_picture(os.path.join(SHOTS, b[1]), width=Cm(10.5) if b[3] == "narrow" else WIDTH)
            c = doc.add_paragraph()
            tag = "LIVE CAPTURE  " if not b[1].startswith("g-") else "GUIDE RECONSTRUCTION  "
            runs(c, tag, 7.5, RGBColor(0x15, 0x80, 0x3D) if not b[1].startswith("g-") else VD, True)
            runs(c, b[2], 8.5, MUT); c.paragraph_format.space_after = Pt(10)
        elif k == "callout":
            t = doc.add_table(rows=1, cols=1); cell_margins(t, 100, 160)
            c = t.rows[0].cells[0]; shade(c, "FDF3E1" if b[1] == "warn" else "F3F0FE")
            tcPr = c._tc.get_or_add_tcPr(); bd = OxmlElement("w:tcBorders")
            e = OxmlElement("w:left"); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "24"); e.set(qn("w:color"), "B7791F" if b[1] == "warn" else "6D4FE0"); bd.append(e); tcPr.append(bd)
            p = c.paragraphs[0]; runs(p, b[2], 10, INK, True); p.paragraph_format.space_after = Pt(2)
            p2 = c.add_paragraph(); runs(p2, b[3], 9.5); p2.paragraph_format.space_after = Pt(0)
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
        elif k == "code":
            t = doc.add_table(rows=1, cols=1); cell_margins(t, 100, 160)
            c = t.rows[0].cells[0]; shade(c, "15121F")
            r = c.paragraphs[0].add_run(b[1]); r.font.name = "Consolas"; r.font.size = Pt(8.5); r.font.color.rgb = RGBColor(0xE9, 0xE4, 0xFF)
            doc.add_paragraph()
        elif k == "kpis":
            t = doc.add_table(rows=2, cols=len(b[1])); borders(t); cell_margins(t, 90, 110)
            for i, (v, l) in enumerate(b[1]):
                shade(t.rows[0].cells[i], "F7F5FD"); shade(t.rows[1].cells[i], "F7F5FD")
                runs(t.rows[0].cells[i].paragraphs[0], v, 17, V, True)
                runs(t.rows[1].cells[i].paragraphs[0], l, 8, MUT)
            doc.add_paragraph()
        elif k == "break":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        elif k == "domain":
            _, no, name, label, status, how, gaps = b
            colour = STATUS_COLOURS[status]
            t = doc.add_table(rows=2, cols=2); borders(t); cell_margins(t, 80, 120)
            hdr = t.rows[0].cells[0].merge(t.rows[0].cells[1]); shade(hdr, "FAF9FD")
            p = hdr.paragraphs[0]; p.paragraph_format.space_after = Pt(0)
            runs(p, f"{no:02d}  ", 10.5, V, True); runs(p, name, 10.5, INK, True)
            r = p.add_run(f"    {label.upper()}"); r.bold = True; r.font.size = Pt(7.5)
            r.font.color.rgb = RGBColor.from_string(colour[0][1:].upper())
            for ci, (lab, items) in enumerate((("HOW FINSIGHT ADDRESSES IT", how), ("GAPS AND DECISIONS", gaps or ["None open."]))):
                c = t.rows[1].cells[ci]
                if ci: shade(c, "FFFDF8")
                runs(c.paragraphs[0], lab, 7, MUT, True)
                for it in items:
                    pp = c.add_paragraph(); pp.paragraph_format.space_after = Pt(2); pp.paragraph_format.left_indent = Cm(0.3)
                    runs(pp, "•  " + it, 8.6)
            for row in t.rows:
                row.cells[0].width, row.cells[1].width = Cm(10.6), Cm(6.8)
            for gc, w in zip(t._tbl.tblGrid.findall(qn("w:gridCol")), (Cm(10.6), Cm(6.8))):
                gc.set(qn("w:w"), str(int(w.twips)))
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
        else:
            raise ValueError(k)
    out = os.path.join(ROOT, OUT_NAME + ".docx")
    doc.save(out)
    print("docx ok", out)


def merge_cover():
    from pypdf import PdfReader, PdfWriter
    pdf = os.path.join(ROOT, OUT_NAME + ".pdf")
    body, cover = PdfReader(pdf), PdfReader(os.path.join(BUILD, "cover.pdf"))
    w = PdfWriter()
    w.add_page(cover.pages[0])
    for pg in body.pages[1:]:
        w.add_page(pg)
    w.add_metadata({"/Title": "FinSight Terminal — Master Product & Engineering Document", "/Author": content.META["owner"]})
    with open(pdf, "wb") as f:
        w.write(f)
    print("cover merged", len(w.pages), "pages")


if __name__ == "__main__":
    {"html": render_html, "docx": render_docx, "cover": merge_cover}[sys.argv[1]]()
