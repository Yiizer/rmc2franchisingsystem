"""Read-only XLSX extraction; private SQLite import is opt-in with --apply."""
import argparse, collections, datetime, hashlib, json, pathlib, re, shutil, sqlite3, unicodedata
import openpyxl
from openpyxl.styles.colors import COLOR_INDEX
import xml.etree.ElementTree as ET
parser=argparse.ArgumentParser();parser.add_argument('workbook');parser.add_argument('--data-dir',required=True);parser.add_argument('--report',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
source=pathlib.Path(args.workbook);batch=hashlib.sha256(source.read_bytes()).hexdigest();w=openpyxl.load_workbook(source,data_only=True); formulas=openpyxl.load_workbook(source,data_only=False)
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
theme=ET.fromstring(w.loaded_theme).find('a:themeElements/a:clrScheme',ns) if w.loaded_theme else None
def color(cell):
 if not cell.fill.patternType:return ''
 c=cell.fill.fgColor; value=''
 if c.type=='rgb':value=str(c.rgb)[-6:]
 elif c.type=='indexed' and c.indexed<len(COLOR_INDEX):value=COLOR_INDEX[c.indexed][-6:]
 elif c.type=='theme' and theme is not None:
  node=list(theme[c.theme])[0];value=node.get('lastClr') or node.get('val','')
 if not re.fullmatch('[0-9a-fA-F]{6}',value):return ''
 if c.tint:
  rgb=[int(value[i:i+2],16) for i in (0,2,4)];rgb=[round(v*(1+c.tint) if c.tint<0 else v*(1-c.tint)+255*c.tint) for v in rgb];value=''.join(f'{v:02X}' for v in rgb)
 return '#'+value.upper()
def legend(sheet,column,row,value):
 return (sheet=='GENERATED MOAs' and column=='I' or sheet=='IWC' and column=='I') and bool(re.search(r'content\s*meaning|pending.*yellow|disapproved.*red|proposal sent.*green|processing.*blue|not yet done.*(?:gray|white|clear)',value,re.I))
def text(value):return value.isoformat() if isinstance(value,(datetime.datetime,datetime.date)) else '' if value is None else str(value).strip()
def norm(value):
 value=''.join(c for c in unicodedata.normalize('NFKD',value) if not unicodedata.combining(c)).lower().replace('&',' and ')
 value=re.sub(r'[^\w]+',' ',value,flags=re.U).replace('_',' ').strip();value=' '.join(value.split())
 for a,b in [('corp','corporation'),('inc','incorporated'),('co','company')]:value=re.sub(r'\b'+a+r'\b',b,value)
 return '' if value.replace(' ','') in ['na','none','unknown','notprovided','notsupplied','unconfirmed'] else value
rows=[];report={'source':source.name,'sha256':batch,'sheets':[],'issues':[],'mappingVersion':2};seen=collections.Counter()
for sheet in w:
 headers=[text(c.value) for c in sheet[1]];count=0;skipped=[]
 if headers[0] not in ['Account name','Accounts:','ACCOUNTS :','F','ACCOUNT','ACCOUNT NAME:','Account Names']:
  report['issues'].append({'sheet':sheet.title,'row':1,'issue':'Unusual account header; preserved in source, review before importing as a record','value':headers[0]})
 for cells in list(sheet.rows)[1:]:
  if not any(c.value is not None for c in cells):continue
  name=text(cells[0].value);key=norm(name)
  if not key:skipped.append(cells[0].row);continue
  raw=[{'column':c.column_letter,'label':headers[c.column-1] or 'Unnamed column','value':text(c.value),'fill':str(c.fill.fgColor.index),'fillType':c.fill.fgColor.type,'color':color(c),'format':c.number_format,'formula':str(formulas[sheet.title][c.coordinate].value) if formulas[sheet.title][c.coordinate].data_type=='f' else '', 'role':'legend' if legend(sheet.title,c.column_letter,c.row,text(c.value)) else 'value'} for c in cells if c.value is not None or c.fill.patternType]
  def find(*tokens):return next((text(c.value) for c in cells if any(t in headers[c.column-1].lower() for t in tokens)), '')
  agent=find('agent');branch=find('branch','division');status_text=find('status');remarks=find('remarks');dates=[{'label':headers[c.column-1],'value':text(c.value)} for c in cells if 'date' in headers[c.column-1].lower() and c.value is not None]
  status='Unknown / needs review' # Labels describe original text, never current eligibility.
  stated=(status_text+' '+remarks).lower()
  for pattern,label in [(r'\bexpired\b','Reported expired'),(r'closed\s*deal','Reported closed deal'),(r'\bon hold\b','Reported on hold'),(r'\bwaiting\b','Reported waiting'),(r'\bprocessing\b','Reported processing')]:
   if re.search(pattern,stated):status=label;break
  data={'source':source.name,'sha256':batch,'dates':dates,'plan':find('plan type'),'statusText':status_text,'remarks':remarks,'cells':raw,'headers':[{'column':c.column_letter,'label':text(c.value)} for c in sheet[1] if c.value is not None],'mappingVersion':2,'reviewNote':'Original colors and dates are evidence only; ownership is unverified.'}
  row_id=hashlib.sha256(f'{batch}:{sheet.title}:{cells[0].row}'.encode()).hexdigest()
  rows.append((row_id,batch,sheet.title,cells[0].row,name,key,agent,branch,status,json.dumps(data,ensure_ascii=False)));count+=1;seen[key]+=1
 report['sheets'].append({'sheet':sheet.title,'records':count,'excludedNonAccountRows':skipped,'headers':[{'column':c.column_letter,'label':text(c.value)} for c in sheet[1] if c.value is not None]})
report.update(records=len(rows),normalizedAccountNames=len(seen),repeatedNameRows=sum(n-1 for n in seen.values()),applied=args.apply)
out=pathlib.Path(args.report);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
if args.apply:
 root=pathlib.Path(args.data_dir);root.mkdir(parents=True,exist_ok=True);database=sqlite3.connect(root/'rmc2.sqlite');database.executescript(pathlib.Path('lib/operations/historical-schema.sql').read_text(encoding='utf-8-sig'))
 archive=root/'historical-sources'/batch;archive.mkdir(parents=True,exist_ok=True);shutil.copy2(source,archive/source.name)
 with database:
  database.executemany('INSERT INTO historical_accounts VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data',rows)
  database.execute('INSERT INTO historical_imports VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET report=excluded.report',(batch,datetime.datetime.now(datetime.timezone.utc).isoformat(),source.name,json.dumps(report)))
 database.close()
print(json.dumps({k:report[k] for k in ['records','normalizedAccountNames','repeatedNameRows','applied']}))

