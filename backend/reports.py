"""Offline PDF checklist from a read-only session snapshot."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FONT_DIR = Path(__file__).parent / 'assets' / 'fonts'
pdfmetrics.registerFont(TTFont('Checklist', str(FONT_DIR / 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('ChecklistBold', str(FONT_DIR / 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFontFamily('Checklist', normal='Checklist', bold='ChecklistBold')

TEXT = {
    'en': {
        'title': 'Model review checklist', 'scope': 'Scope: intersections and fit tolerance',
        'complete': 'MANUAL REVIEW COMPLETE', 'incomplete': 'MANUAL REVIEW INCOMPLETE',
        'reviewed': 'Reviewed', 'pending': 'Pending', 'notChecked': 'Not checked', 'stale': 'Out of date',
        'clear': 'No intersections', 'intersections': 'Intersections', 'coincident': 'Coincident',
        'fits': 'Within tolerance', 'uncertain': 'Needs review', 'generated': 'Generated',
        'parts': 'Parts', 'margin': 'Fit margin', 'part': 'Part', 'result': 'Analysis result',
        'review': 'Manual review', 'notes': 'Notes', 'current': 'Analysis current', 'yes': 'Yes', 'no': 'No',
    },
    'pl': {
        'title': 'Checklista przeglądu modelu', 'scope': 'Zakres: intersekcje i margines dopasowania',
        'complete': 'PRZEGLĄD RĘCZNY ZAKOŃCZONY', 'incomplete': 'PRZEGLĄD RĘCZNY NIEZAKOŃCZONY',
        'reviewed': 'Sprawdzone', 'pending': 'Do sprawdzenia', 'notChecked': 'Niesprawdzone', 'stale': 'Nieaktualne',
        'clear': 'Brak intersekcji', 'intersections': 'Intersekcje', 'coincident': 'Pełne pokrycie',
        'fits': 'W marginesie dopasowania', 'uncertain': 'Do weryfikacji', 'generated': 'Wygenerowano',
        'parts': 'Części', 'margin': 'Margines dopasowania', 'part': 'Część', 'result': 'Wynik analizy',
        'review': 'Przegląd ręczny', 'notes': 'Notatki', 'current': 'Analiza aktualna', 'yes': 'Tak', 'no': 'Nie',
    },
}


def analysis_label(task, text):
    if not task:
        return text['notChecked']
    if task['stale']:
        return text['stale']
    labels = []
    for field, label in [('intersections', 'intersections'), ('coincident_pairs', 'coincident'),
                         ('uncertain_pairs', 'uncertain'), ('fit_pairs', 'fits')]:
        count = task.get(field, 0)
        if count:
            labels.append(f"{text[label]}: {count}")
    return '\n'.join(labels) if labels else text['clear']


def checklist_pdf(parts, tasks, language, utc_offset_minutes, version, fit_tolerance):
    text = TEXT[language]
    generated = datetime.now(timezone.utc).astimezone(timezone(timedelta(minutes=utc_offset_minutes)))
    current = all(tasks.get(part['id']) and not tasks[part['id']]['stale'] for part in parts)
    done = sum(bool(tasks.get(part['id'], {}).get('done')) and not tasks[part['id']]['stale'] for part in parts)
    complete = current and done == len(parts)
    buffer = BytesIO()
    ink, muted, accent = colors.HexColor('#283d4a'), colors.HexColor('#617783'), colors.HexColor('#397d87')
    body = ParagraphStyle('Body', fontName='Checklist', fontSize=8, leading=12, textColor=ink,
                          alignment=TA_LEFT, splitLongWords=True)
    bold = ParagraphStyle('Bold', parent=body, fontName='ChecklistBold')
    title = ParagraphStyle('Title', parent=bold, fontSize=21, leading=27, spaceAfter=8)
    caption = ParagraphStyle('Caption', parent=body, fontSize=9, leading=14, textColor=muted)

    def para(value, style=body):
        # Filenames/notes are text, never ReportLab markup or external resources.
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), style)

    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=40, bottomMargin=43,
                            title=text['title'], author='ModelCheck 3D', creator=f'ModelCheck 3D {version}')
    story = [para('MODELCHECK 3D', caption), Spacer(1, 10), para(text['title'], title), para(text['scope'], caption), Spacer(1, 18)]
    banner = Table([[para(text['complete'] if complete else text['incomplete'], bold),
                     para(f"{text['reviewed']}: {done} / {len(parts)}", bold)]], colWidths=[350, doc.width - 350])
    banner.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#e6f2ef' if complete else '#f6efe2')),
        ('BOX', (0, 0), (-1, -1), .5, colors.HexColor('#cfdfdc' if complete else '#e7dcc5')),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story += [banner, Spacer(1, 12)]
    offset = generated.strftime('%z')
    offset = f'UTC{offset[:3]}:{offset[3:]}'
    stamp = generated.strftime('%d.%m.%Y %H:%M' if language == 'pl' else '%Y-%m-%d %H:%M')
    margin = str(fit_tolerance).replace('.', ',') if language == 'pl' else str(fit_tolerance)
    story += [para(f"{text['generated']}: {stamp} ({offset})", caption),
              para(f"{text['parts']}: {len(parts)}   |   {text['margin']}: {margin} mm   |   {text['current']}: {text['yes'] if current else text['no']}", caption), Spacer(1, 18)]
    rows = [[para(text[key], bold) for key in ['part', 'result', 'review', 'notes']]]
    duplicates = Counter(part['name'] for part in parts)
    for index, part in enumerate(parts, 1):
        task = tasks.get(part['id'])
        checked = task and not task['stale'] and task['done']
        name = part['name'] + (f' · {index}' if duplicates[part['name']] > 1 else '')
        rows.append([para(f'{index}. {name}'), para(analysis_label(task, text)),
                     para(text['reviewed'] if checked else text['pending']), para(task['note'] if task and task['note'] else '—')])
    table = LongTable(rows, colWidths=[doc.width * .28, doc.width * .25, doc.width * .17, doc.width * .30],
                      repeatRows=1, splitByRow=True, splitInRow=True, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf0f4')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafb')]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, 0), .8, accent),
        ('LINEBELOW', (0, 1), (-1, -1), .3, colors.HexColor('#e0e7ec')),
        ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(table)

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#dce5eb')); canvas.setLineWidth(.5)
        canvas.line(36, 31, A4[0] - 36, 31)
        canvas.setFont('Checklist', 8); canvas.setFillColor(muted)
        canvas.drawString(36, 19, f'ModelCheck 3D · {version}')
        canvas.drawRightString(A4[0] - 36, 19, str(document.page))
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue(), f'modelcheck-checklist-{generated:%Y-%m-%d}.pdf'
