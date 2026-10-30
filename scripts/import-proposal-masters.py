"""Import reviewed masters; preserve original files, previous catalogs and unrelated plans."""
import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
ORIGINAL_IDS = ['D023','D024','D025','D026','D054','D055','D056','D091','D092','D093','D094','D095','D096']
UPDATED_FILES = {
    'RMC2 - PROPOSAL - BUREAUHEALTH 4,250.docx': 'D023',
    'RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K - 001.docx': 'D024',
    'RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K PEC & DREADED COVERED - 001.docx': 'D025',
    'RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K PEC COVERED - 001.docx': 'D026',
    'RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK - 001.docx': 'D054',
    'RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK PEC & DREADED COVERED - 001.docx': 'D055',
    'RMC2 - PROPOSAL - TOTAL CORPOHEALTHCHECK PEC COVERED - 001.docx': 'D056',
    'RMC2 - PROPOSAL - TOTAL CORPOSHIELD - 001.docx': 'D094',
    'RMC2 - PROPOSAL - TOTAL CORPOSHIELD PEC & DREADED COVERED - 001.docx': 'D095',
    'RMC2 - PROPOSAL - TOTAL CORPOSHIELD PEC COVERED - 001.docx': 'D096',
    'RMC2 - PROPOSAL - BUREAUHEALTH 7K & 5K DEPED SEMI ANNUAL OP LIMIT - 001.docx': 'D097',
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def describe(sid, source, out):
    raw = source.read_bytes()
    with zipfile.ZipFile(source) as archive:
        if 'word/vbaProject.bin' in archive.namelist():
            raise ValueError(f'Macro-enabled source is not supported: {source.name}')
        doc = ET.fromstring(archive.read('word/document.xml'))
        text = '\n'.join(''.join(t.text or '' for t in p.findall('.//w:t', NS)) for p in doc.findall('.//w:p', NS))
    name = source.name.upper()
    family = ('BureauHealth 4,250' if '4,250' in name else
              'BureauHealth 7K & 5K' if 'BUREAUHEALTH' in name else
              'Total CorpoHealthCheck' if 'CORPOHEALTHCHECK' in name else
              'CorpoAide 2' if 'CORPOAIDE 2' in name else 'Total CorpoShield')
    variant = ('DepEd semiannual OP limit' if sid == 'D097' else
               'PEC + dreaded covered' if 'DREADED' in name else 'PEC covered' if 'PEC' in name else 'Standard')
    warnings = []
    if sid in ['D024','D025','D026'] and re.search(r'ANNUAL\s+PREMIUM\s+FOR\s+PRINCIPAL\s*:\s*PHP\s*6,?000', text, re.I):
        warnings.append('The source labels the PHP 6,000 line as another principal rate. No dependent rate is inferred from that label.')
    if sid == 'D023':
        warnings.append('This proposal states VAT exclusive and does not supply dependent rates.')
    if sid == 'D026':
        warnings.append('The supplied eligibility-page heading sits close to the logo/header. Review the PDF spacing before sending.')
    if family == 'Total CorpoShield':
        warnings.append('CorpoPlus room type follows the proposal: Regular Private. TOR/MOA differences are not merged into this document.')
    if sid == 'D097':
        warnings.append('The semiannual wording describes the outpatient benefit limit. The supplied premiums remain annual; semiannual premium payments are not inferred.')
    elif variant != 'Standard':
        warnings.append('Coverage variant is selected by staff. Review its waiting periods, major-surgery exclusions and eligibility wording in the source.')
    digest = sha(raw)
    filename = sid + '-' + digest + '.docx'
    entry = {'id':sid.lower(), 'name':family+' · '+variant, 'family':family, 'variant':variant,
             'sector':'Government' if family.startswith('BureauHealth') else 'All',
             'sourceName':source.name, 'sourceId':sid, 'sourceHash':digest,
             'file':'resources/private/'+filename, 'text':text,
             'placeholders':sorted(set(re.findall(r'\[[^\[\]\n]{1,80}\]',text))), 'warnings':warnings,
             'annualOnly':family.startswith('BureauHealth') or family=='CorpoAide 2', 'active':True}
    return entry, raw, out / filename


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--source', help='Original source collection for bootstrap')
    mode.add_argument('--updates', help='Reviewed replacement batch; merge into the existing catalog')
    parser.add_argument('--dry-run', action='store_true', help='Validate/list changes without writing')
    args = parser.parse_args()
    out = ROOT / 'resources/private'
    catalog_file = out / 'catalog.json'
    previous_bytes = catalog_file.read_bytes() if catalog_file.exists() else None
    previous = json.loads(previous_bytes) if previous_bytes else []
    if len({item['id'] for item in previous}) != len(previous):
        raise ValueError('Duplicate IDs in the existing catalog; review before import.')
    for item in previous:
        existing = out / Path(item['file']).name
        if not existing.is_file() or sha(existing.read_bytes()) != item['sourceHash']:
            raise ValueError(f'Existing source is missing or changed: {item["sourceId"]}')
    if args.updates:
        if not previous:
            raise ValueError('Bootstrap original masters before applying replacements.')
        found = {p.name:p for p in Path(args.updates).glob('*.docx') if not p.name.startswith('~$')}
        missing, unknown = set(UPDATED_FILES)-set(found), set(found)-set(UPDATED_FILES)
        if missing or unknown:
            raise ValueError(f'Review batch mapping. Missing: {sorted(missing)}; unmapped: {sorted(unknown)}')
        sources = [(sid, found[name]) for name,sid in UPDATED_FILES.items()]
        form = None
    else:
        root = Path(args.source or 'D:/DOWNLOADS/rmc2 files/extracted')
        paths = sorted((p for p in root.rglob('*.docx') if 'PROPOSAL TEMPLATES' in str(p) and 'DONE' not in p.parts), key=lambda p:str(p).lower())
        if len(paths) != len(ORIGINAL_IDS):
            raise ValueError(f'Expected 13 original masters, found {len(paths)}. Review the source collection.')
        sources = list(zip(ORIGINAL_IDS, paths))
        form = root.parents[1] / 'FRANCHISE FORM EXAMPLE.xlsx'
    staged = [describe(sid, source, out) for sid,source in sources]
    merged = {item['id']:item for item in previous}
    changes = []
    for entry,raw,target in staged:
        old = merged.get(entry['id'])
        changes.append({'sourceId':entry['sourceId'], 'name':entry['name'],
                        'change':'added' if old is None else 'unchanged' if old['sourceHash']==entry['sourceHash'] else 'updated',
                        'sourceHash':entry['sourceHash']})
        if target.exists() and sha(target.read_bytes()) != sha(raw):
            raise ValueError(f'Immutable master path has different bytes: {target.name}')
        merged[entry['id']] = entry
    families = ['BureauHealth 4,250','BureauHealth 7K & 5K','Total CorpoHealthCheck','CorpoAide 2','Total CorpoShield']
    catalog = sorted(merged.values(), key=lambda item:(families.index(item['family']), item['sourceId']))
    if not args.dry_run:
        out.mkdir(parents=True, exist_ok=True)
        if previous_bytes:
            history = out / 'catalog-history'
            history.mkdir(exist_ok=True)
            backup = history / (sha(previous_bytes)+'.json')
            if not backup.exists():
                backup.write_bytes(previous_bytes)
        for entry,raw,target in staged:
            if not target.exists():
                with target.open('xb') as output:
                    output.write(raw)
            if sha(target.read_bytes()) != entry['sourceHash']:
                raise ValueError(f'Imported master failed verification: {entry["sourceId"]}')
        fd, temporary = tempfile.mkstemp(prefix='catalog-', suffix='.tmp', dir=out)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                json.dump(catalog, output, ensure_ascii=False, indent=2)
                output.write('\n')
            os.replace(temporary, catalog_file)
        finally:
            if Path(temporary).exists():
                Path(temporary).unlink()
        if form is not None and form.exists() and not (out/'franchise-form.xlsx').exists():
            shutil.copyfile(form, out/'franchise-form.xlsx')
    print(json.dumps({'dryRun':args.dry_run, 'templates':len(catalog), 'changes':changes}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
