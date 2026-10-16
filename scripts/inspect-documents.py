"""Local generated-document checks; writes QA images only, never changes masters."""
import json
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from pypdf import PdfReader
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
results = json.loads((root / 'test-results/workflow.json').read_text())
catalog = {item['id']: item for item in json.loads((root / 'resources/private/catalog.json').read_text())}
target = root / 'test-results/documents'
target.mkdir(parents=True, exist_ok=True)
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
normalize = lambda value: re.sub(r'[^\w]', '', unicodedata.normalize('NFKC', value)).lower()
poppler = shutil.which('pdftoppm')
assert poppler, 'Bundled Poppler is needed for document inspection'
report = []
for item in results['generated']:
    template = catalog[item['templateId']]
    with ZipFile(root / template['file']) as source, ZipFile(root / '.data' / item['docx']) as generated:
        assert set(source.namelist()) == set(generated.namelist()), item['sourceId'] + ' package parts differ'
        changed = [name for name in source.namelist() if source.read(name) != generated.read(name)]
        assert all(re.match(r'word/(document|header\d+|footer\d+)\.xml$', name) for name in changed), changed
        original = ET.fromstring(source.read('word/document.xml'))
        filled = ET.fromstring(generated.read('word/document.xml'))
        for name in ['p','tbl','tr','tc','drawing']:
            assert len(original.findall('.//w:'+name, ns)) == len(filled.findall('.//w:'+name, ns)), item['sourceId']+' '+name
        source_paragraphs = original.findall('.//w:p', ns)
        paragraphs = filled.findall('.//w:p', ns)
        for before, after in zip(source_paragraphs, paragraphs):
            before_text = ''.join(before.itertext())
            after_text = ''.join(after.itertext())
            if '[' not in before_text:
                assert before_text == after_text, item['sourceId']+' changed source term: '+before_text[:80]
        text_paragraphs = [''.join(element.text or '' for element in p.findall('.//w:t',ns)) for p in paragraphs]
    reader = PdfReader(root / '.data' / item['pdf'])
    assert all(page.extract_text().strip() for page in reader.pages), item['sourceId']+' contains an empty page'
    pdf_text = '\n'.join(page.extract_text() for page in reader.pages)
    normalized = normalize(pdf_text)
    missing = [text for text in text_paragraphs if len(normalize(text)) > 40 and normalize(text) not in normalized]
    assert not re.search(r'\[(Date|Client|Account name|Agent name|Proposal Addresse)',pdf_text,re.I), item['sourceId']+' unfilled PDF slot'
    assert normalize(item['fields']['company']) in normalized, item['sourceId']+' account missing from PDF'
    prefix = target / item['sourceId']
    for old_page in target.glob(item['sourceId']+'-*.png'):
        old_page.unlink()
    subprocess.run([poppler,'-scale-to','420','-png',str(root/'.data'/item['pdf']),str(prefix)],check=True,capture_output=True)
    images = sorted(target.glob(item['sourceId']+'-*.png'))
    width,height = 440,452
    canvas = Image.new('RGB',(width*4,height*((len(images)+3)//4)), '#e5e9ee')
    draw = ImageDraw.Draw(canvas)
    for index,file in enumerate(images):
        page = Image.open(file).convert('RGB')
        x,y = (index%4)*width,(index//4)*height
        canvas.paste(page,(x+(width-page.width)//2,y+24))
        draw.text((x+12,y+6),item['sourceId']+' page '+str(index+1),fill='#092143')
    canvas.save(target/(item['sourceId']+'-overview.jpg'))
    entry={'source':item['sourceId'],'pages':len(reader.pages),'unchangedParts':len(source.namelist())-len(changed),'changedParts':changed,'missingParagraphs':missing}
    report.append(entry)
    print(item['sourceId']+': '+str(len(reader.pages))+' pages, '+str(len(missing))+' paragraphs requiring text inspection',flush=True)
(target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
