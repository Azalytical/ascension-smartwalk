"""Render the defence speech and video plan into the submission PDF.

Usage: python3 scripts/build_defense_pdf.py
Reads docs/defense-and-screencast.txt, writes deliverables/ascension-smartwalk-defense-and-screencast.pdf.
Format of the text: three title lines, then blocks separated by blank lines. A block whose first line
looks like "NN / 0:00-0:25 / Title" is a slide; an all-caps first line is a section heading.
"""
from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / 'defense-and-screencast.txt'
OUT = ROOT / 'deliverables' / 'ascension-smartwalk-defense-and-screencast.pdf'

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
BODY = ParagraphStyle('body', fontName='Body', fontSize=9.6, leading=13.6, textColor=INK, spaceAfter=5)
SMALL = ParagraphStyle('small', parent=BODY, fontSize=8.4, leading=11.6, textColor=MUTED)
H1 = ParagraphStyle('h1', parent=BODY, fontName='BodyBold', fontSize=24, leading=28, spaceAfter=4)
SUB = ParagraphStyle('sub', parent=BODY, fontName='BodyBold', fontSize=12, leading=16, spaceAfter=2)
H2 = ParagraphStyle('h2', parent=BODY, fontName='BodyBold', fontSize=13, leading=17, spaceBefore=12, spaceAfter=6)
TAG = ParagraphStyle('tag', parent=BODY, fontName='BodyBold', fontSize=8.5, textColor=GOLD, spaceBefore=6, spaceAfter=2)
SLIDE = re.compile(r'^(\d{2}) / ([\d:]+-[\d:]+) / (.+)$')
SCENE = re.compile(r'^([\d:]+-[\d:]+) / (.+)$')


def esc(text):
    return html.escape(text)


def build():
    lines = SRC.read_text(encoding='utf-8').splitlines()
    title, subtitle, kicker = lines[:3]
    story = [Paragraph(esc(title), H1), Paragraph(esc(subtitle), SUB), Paragraph(esc(kicker), SMALL), Spacer(1, 8)]
    blocks, block = [], []
    for line in lines[3:] + ['']:
        if line.strip():
            block.append(line.strip())
        elif block:
            blocks.append(block)
            block = []
    for head, *rest in blocks:
        slide, scene = SLIDE.match(head), SCENE.match(head)
        if slide:
            num, span, name = slide.groups()
            items = [Paragraph(f'СЛАЙД {num} · {esc(span)}', TAG), Paragraph(f'<b>{esc(name)}</b>', BODY)]
        elif scene:
            span, name = scene.groups()
            items = [Paragraph(esc(span), TAG), Paragraph(f'<b>{esc(name)}</b>', BODY)]
        elif head.isupper():
            items = [Paragraph(esc(head.capitalize()), H2)]
        else:
            items = [Paragraph(esc(head), BODY)]
        items += [Paragraph(esc(text), BODY) for text in rest]
        story.append(KeepTogether(items))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Body', 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(42, 24, 'Aidem by Ascension · Build with AI 2026')
        canvas.drawRightString(A4[0] - 42, 24, str(doc.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=42, rightMargin=42, topMargin=44, bottomMargin=44,
                            title='Aidem: сценарий защиты и видеоролика', author='Ascension')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUT.relative_to(ROOT))


if __name__ == '__main__':
    build()
