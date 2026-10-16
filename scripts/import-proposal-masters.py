"""Import only unfilled proposal masters. Originals are never modified or committed."""
import argparse, hashlib, json, re, shutil, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

parser=argparse.ArgumentParser()
parser.add_argument('--source', default='D:/DOWNLOADS/rmc2 files/extracted')
args=parser.parse_args()
root=Path(args.source)
out=Path(__file__).resolve().parents[1]/'resources/private'
out.mkdir(parents=True,exist_ok=True)
ids=['D023','D024','D025','D026','D054','D055','D056','D091','D092','D093','D094','D095','D096']
paths=sorted([p for p in root.rglob('*.docx') if 'PROPOSAL TEMPLATES' in str(p) and 'DONE' not in p.parts],key=lambda p:str(p).lower())
if len(paths)!=13: raise SystemExit(f'Expected 13 proposal masters, found {len(paths)}. Check the source folders before importing.')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
catalog=[]
for sid,p in zip(ids,paths):
    name=p.name.upper()
    family='BureauHealth 4,250' if '4,250' in name else 'BureauHealth 7K & 5K' if 'BUREAUHEALTH' in name else 'Total CorpoHealthCheck' if 'CORPOHEALTHCHECK' in name else 'CorpoAide 2' if 'CORPOAIDE 2' in name else 'Total CorpoShield'
    variant='PEC + dreaded covered' if 'DREADED' in name else 'PEC covered' if 'PEC' in name else 'Standard'
    with zipfile.ZipFile(p) as z:
        doc=ET.fromstring(z.read('word/document.xml'))
        paragraphs=[''.join(e.itertext()) for e in doc.findall('.//w:p',ns)]
        text='\n'.join(''.join(t.text or '' for t in e.findall('.//w:t',ns)) for e in doc.findall('.//w:p',ns))
    target=out/(sid+'.docx')
    shutil.copyfile(p,target)
    warnings=[]
    if sid in ['D024','D025','D026']: warnings.append('The source labels the PHP 6,000 line as another principal rate. No dependent rate is inferred from that label.')
    if sid=='D023': warnings.append('This proposal states VAT exclusive and does not supply dependent rates.')
    if family=='Total CorpoShield': warnings.append('CorpoPlus room type follows the proposal: Regular Private. TOR/MOA differences are not merged into this document.')
    if variant!='Standard': warnings.append('Coverage variant is selected by staff. Review its waiting periods, major-surgery exclusions and eligibility wording in the source.')
    catalog.append({'id':sid.lower(),'name':family+' · '+variant,'family':family,'variant':variant,'sector':'Government' if 'BureauHealth' in family else 'All','sourceName':p.name,'sourceId':sid,'sourceHash':hashlib.sha256(p.read_bytes()).hexdigest(),'file':'resources/private/'+sid+'.docx','text':text,'placeholders':sorted(set(re.findall(r'\[[^\[\]\n]{1,80}\]',text))),'warnings':warnings,'annualOnly':family.startswith('BureauHealth') or family=='CorpoAide 2','active':True})
(out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
form=root.parents[1]/'FRANCHISE FORM EXAMPLE.xlsx'
if form.exists(): shutil.copyfile(form,out/'franchise-form.xlsx')
print(json.dumps({'templates':len(catalog),'sourceIds':[p['sourceId'] for p in catalog],'formAvailable':form.exists()}))
