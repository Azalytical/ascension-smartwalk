from pathlib import Path
import re, json, html
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether, Flowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

BASE=Path(r'C:\Users\Azalytical\OneDrive\Desktop\Hackathon\gdg2026-smartwalk')
DOCS=BASE/'docs'; OUT=BASE/'deliverables'; PREV=OUT/'slide-previews'
INK=colors.HexColor('#153D3B'); TEAL=colors.HexColor('#1D8B82'); PAPER=colors.HexColor('#F3F0E7'); MUTED=colors.HexColor('#52716B'); ORANGE=colors.HexColor('#CF653E')
pdfmetrics.registerFont(TTFont('Segoe',r'C:\Windows\Fonts\segoeui.ttf'))
pdfmetrics.registerFont(TTFont('SegoeB',r'C:\Windows\Fonts\segoeuib.ttf'))
pdfmetrics.registerFontFamily('Segoe',normal='Segoe',bold='SegoeB',italic='Segoe',boldItalic='SegoeB')
STYLE=ParagraphStyle('body',fontName='Segoe',fontSize=10.2,leading=14.6,textColor=INK,spaceAfter=8)
SMALL=ParagraphStyle('small',parent=STYLE,fontSize=8.5,leading=12,textColor=MUTED)
H1=ParagraphStyle('h1',parent=STYLE,fontName='SegoeB',fontSize=27,leading=31,spaceAfter=17)
H2=ParagraphStyle('h2',parent=STYLE,fontName='SegoeB',fontSize=16,leading=21,spaceBefore=11,spaceAfter=9)
TAG=ParagraphStyle('tag',parent=STYLE,fontName='SegoeB',fontSize=9,leading=12,textColor=TEAL,spaceAfter=7)
def norm(t):return t.replace('—','-').replace('–','-').replace('‑','-').replace('·',' / ')
def para(t,style=STYLE):return Paragraph(html.escape(norm(t)).replace('\n','<br/>'),style)
def footer(c,doc):
 w,h=A4;c.saveState();c.setFillColor(PAPER);c.rect(0,0,w,32,fill=1,stroke=0);c.setStrokeColor(colors.HexColor('#CFD8CF'));c.line(42,39,w-42,39);c.setFillColor(MUTED);c.setFont('Segoe',8);c.drawString(42,20,'Aidem by Ascension  /  Build with AI 2026');c.drawRightString(w-42,20,str(doc.page));c.restoreState()
def docbuild(file,story,title):
 d=SimpleDocTemplate(str(OUT/file),pagesize=A4,rightMargin=43,leftMargin=43,topMargin=43,bottomMargin=55,title=title,author='Ascension',pageCompression=1);d.build(story,onFirstPage=footer,onLaterPages=footer)
def rule(story,title,sub=None):
 story.append(para('ASCENSION  /  SMART CITY',TAG));story.append(para(title,H1))
 if sub:story.append(para(sub,SMALL))
def addtext(story,text):
 for block in text.strip().split('\n\n'):
  if not block.strip():continue
  if '\n' not in block and len(block)<75 and not block.endswith('.'):
   story.append(para(block,H2))
  else:story.append(para(block))

# PDF copy of the visually reviewed slide renders. PPTX remains editable.
deck_path=OUT/'ascension-smartwalk-presentation.pdf'
c=canvas.Canvas(str(deck_path),pagesize=(960,540),pageCompression=1)
c.setTitle('Aidem by Ascension - Build with AI 2026');c.setAuthor('Ascension')
for i in range(1,10):
 c.drawImage(str(PREV/f'slide-{i:02d}.png'),0,0,width=960,height=540)
 c.showPage()
c.save()

# The tests PDF is built by scripts/build_protocol_pdf.py from docs/test-protocol.md; the 19 October
# defense and screencast PDF was retired. This script only renders the slide PDF.

report={}
for f in OUT.glob('*.pdf'):
 r=PdfReader(str(f));report[f.name]={'bytes':f.stat().st_size,'pages':len(r.pages),'text_chars':sum(len(p.extract_text() or '') for p in r.pages)}
(DOCS/'.build/pdf-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
