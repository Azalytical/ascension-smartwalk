"""Render the scenario protocol, limitations and ethics notes into the submission PDF.

Usage: python3 scripts/build_protocol_pdf.py
Reads docs/test-protocol.md (from scripts/scenario-protocol.mjs), docs/concept.md and docs/ethics.md,
writes deliverables/ascension-smartwalk-tests-and-limitations.pdf.
"""
from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'deliverables' / 'ascension-smartwalk-tests-and-limitations.pdf'

FONTS = [
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    (r'C:\Windows\Fonts\segoeui.ttf', r'C:\Windows\Fonts\segoeuib.ttf'),
    (r'C:\Windows\Fonts\arial.ttf', r'C:\Windows\Fonts\arialbd.ttf'),
]
regular, bold = next((r, b) for r, b in FONTS if Path(r).exists() and Path(b).exists())
pdfmetrics.registerFont(TTFont('Body', regular))
pdfmetrics.registerFont(TTFont('BodyBold', bold))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')

INK = colors.HexColor('#0E1621')
GOLD = colors.HexColor('#B88A00')
MUTED = colors.HexColor('#5B6573')
LINE = colors.HexColor('#D9DDE3')
BODY = ParagraphStyle('body', fontName='Body', fontSize=9.4, leading=13.2, textColor=INK, spaceAfter=5)
SMALL = ParagraphStyle('small', parent=BODY, fontSize=8.2, leading=11.4, textColor=MUTED)
BULLET = ParagraphStyle('bullet', parent=BODY, leftIndent=12, bulletIndent=2, spaceAfter=2.5)
H1 = ParagraphStyle('h1', parent=BODY, fontName='BodyBold', fontSize=21, leading=26, spaceAfter=10)
H2 = ParagraphStyle('h2', parent=BODY, fontName='BodyBold', fontSize=13, leading=17, spaceBefore=10, spaceAfter=6)
TAG = ParagraphStyle('tag', parent=BODY, fontName='BodyBold', fontSize=8.5, textColor=GOLD, spaceAfter=4)
CELL = ParagraphStyle('cell', parent=BODY, fontSize=8.4, leading=11, spaceAfter=0)


def inline(text):
    """Escape, then turn **bold** and `code` into reportlab markup."""
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = re.sub(r'\[(.+?)\]\((.+?)\)', r'\1', text)
    return text.replace('✅', '[Pass]').replace('❌', '[Fail]')


def render(markdown, story, skip_title=False):
    lines = markdown.splitlines()
    table = []
    for line in lines + ['']:
        if line.startswith('|'):
            cells = [cell.strip() for cell in line.strip('|').split('|')]
            if not all(re.fullmatch(r'-+', cell) for cell in cells):
                table.append(cells)
            continue
        if table:
            widths = [A4[0] - 86] if len(table[0]) == 1 else None
            data = [[Paragraph(inline(cell), CELL) for cell in row] for row in table]
            grid = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
            grid.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.4, LINE), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F4F3EF')),
                                      ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
            story.extend([grid, Spacer(1, 6)])
            table = []
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith('# '):
            if not skip_title:
                story.append(Paragraph(inline(stripped[2:]), H1))
        elif stripped.startswith('## '):
            story.append(Paragraph(inline(stripped[3:]), H2))
        elif re.match(r'^(- |\d+\. )', stripped):
            marker = '•' if stripped.startswith('- ') else stripped.split('.')[0] + '.'
            story.append(Paragraph(inline(re.sub(r'^(- |\d+\. )', '', stripped)), BULLET, bulletText=marker))
        elif line.startswith('   '):
            story.append(Paragraph(inline(stripped), ParagraphStyle('sub', parent=BULLET, leftIndent=22, textColor=MUTED, fontSize=8.6, leading=12)))
        else:
            story.append(Paragraph(inline(stripped), BODY))


def section(markdown, heading):
    """The '## heading' section of a markdown file, heading included."""
    match = re.search(rf'^## {re.escape(heading)}\n(.*?)(?=^## |\Z)', markdown, flags=re.S | re.M)
    return f'## {heading}\n{match.group(1)}' if match else ''


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(43, 40, A4[0] - 43, 40)
    canvas.setFont('Body', 7.8)
    canvas.setFillColor(MUTED)
    canvas.drawString(43, 27, 'Aidem (SmartWalk) by Ascension · Build with AI Hackathon 2026 · НИЦ Smart City')
    canvas.drawRightString(A4[0] - 43, 27, str(doc.page))
    canvas.restoreState()


def main():
    protocol = (ROOT / 'docs' / 'test-protocol.md').read_text(encoding='utf-8')
    concept = (ROOT / 'docs' / 'concept.md').read_text(encoding='utf-8')
    ethics = (ROOT / 'docs' / 'ethics.md').read_text(encoding='utf-8')
    story = [Paragraph('ASCENSION · SMART CITY · BUILD WITH AI 2026', TAG),
             Paragraph('Aidem (SmartWalk): тестовые сценарии, ограничения и этика', H1),
             Paragraph('Документ сдачи по задаче НИЦ Smart City: набор тестовых сценариев с входными данными, ожидаемым типом ответа и '
                       'фактическим результатом прогона, затем ограничения, риски и заметки об этике и приватности. Aidem («Айдём»): «айда» + «идём», приглашение пройтись. '
                       'SmartWalk — рабочее имя до 20 октября, оно осталось в адресе сайта, в репозитории и в первом ролике.', BODY),
             Spacer(1, 4)]
    render(protocol, story, skip_title=True)
    story.append(PageBreak())
    story.append(Paragraph('Ограничения и риски', H1))
    render(section(concept, 'Ограничения'), story)
    render(section(concept, 'Риски и как мы их снижаем'), story)
    story.append(PageBreak())
    render(ethics, story)
    OUT.parent.mkdir(exist_ok=True)
    document = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=43, rightMargin=43, topMargin=43, bottomMargin=56,
                                 title='Aidem (SmartWalk): тестовые сценарии, ограничения и этика', author='Ascension')
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUT.relative_to(ROOT), OUT.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
