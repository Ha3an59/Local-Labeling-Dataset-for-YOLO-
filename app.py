from flask import Flask, render_template, request, jsonify, send_file, abort
from pathlib import Path
import json, zipfile, random, shutil, re, tempfile
from datetime import datetime
from PIL import Image

BASE = Path(__file__).resolve().parent
PROJECTS = BASE / 'projects'; PROJECTS.mkdir(exist_ok=True)
app = Flask(__name__)
IMAGE_EXT={'.jpg','.jpeg','.png','.webp','.bmp'}
VIDEO_EXT={'.mp4','.avi','.mov','.mkv','.webm'}

def safe_project(name):
    name=''.join(c for c in str(name) if c.isalnum() or c in '-_ ').strip().replace(' ','_')
    return name[:80] or 'project'
def pdir(name): return PROJECTS/safe_project(name)
def meta_path(name): return pdir(name)/'project.json'
def load_meta(name):
    p=meta_path(name)
    if not p.exists(): abort(404)
    return json.loads(p.read_text(encoding='utf-8'))
def save_meta(name,meta):
    pdir(name).mkdir(parents=True,exist_ok=True)
    meta_path(name).write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
def project_list():
    out=[]
    for p in sorted(PROJECTS.iterdir()):
        if p.is_dir() and (p/'project.json').exists():
            try: out.append(json.loads((p/'project.json').read_text(encoding='utf-8')))
            except Exception: pass
    return out
def next_number(meta, kind):
    pat=r'^(?:video_)?(\d+)'
    nums=[]
    for k,v in meta['items'].items():
        if v.get('type')!=kind: continue
        m=re.match(pat,Path(k).stem)
        if m: nums.append(int(m.group(1)))
    return max(nums,default=-1)+1
def fit01(x): return max(0.0,min(1.0,float(x)))

@app.route('/')
def index(): return render_template('index.html',projects=project_list())
@app.get('/api/projects')
def list_projects(): return jsonify(projects=project_list())
@app.post('/api/projects')
def create_project():
    data=request.get_json() or {}; name=safe_project(data.get('name','project'))
    if meta_path(name).exists(): return jsonify(error='Project already exists'),409
    d=pdir(name)
    for x in ('images','videos','frames','labels'): (d/x).mkdir(parents=True,exist_ok=True)
    meta={'name':name,'classes':[str(x).strip() for x in data.get('classes',[]) if str(x).strip()],'items':{},'created_at':datetime.now().isoformat(),'updated_at':datetime.now().isoformat()}
    save_meta(name,meta); return jsonify(meta)
@app.get('/api/projects/<name>')
def get_project(name): return jsonify(load_meta(name))
@app.post('/api/projects/<name>/classes')
def classes(name):
    meta=load_meta(name); n=str((request.get_json() or {}).get('name','')).strip()
    if n and n not in meta['classes']: meta['classes'].append(n)
    meta['updated_at']=datetime.now().isoformat(); save_meta(name,meta); return jsonify(meta)

@app.post('/api/projects/<name>/upload')
def upload(name):
    meta=load_meta(name); d=pdir(name); added=[]; image_idx=next_number(meta,'image'); video_idx=next_number(meta,'video')
    for f in request.files.getlist('files'):
        if not f.filename: continue
        ext=Path(f.filename).suffix.lower()
        if ext in IMAGE_EXT:
            target=d/'images'/f'{image_idx:06d}{ext}'; image_idx+=1; typ='image'
        elif ext in VIDEO_EXT:
            target=d/'videos'/f'video_{video_idx:06d}{ext}'; video_idx+=1; typ='video'
        else: continue
        f.save(target); key=target.relative_to(d).as_posix(); item={'type':typ,'labels':[],'original_name':f.filename}
        if typ=='image':
            try:
                with Image.open(target) as im: item.update(width=im.width,height=im.height)
            except Exception: pass
        else:
            try:
                import cv2; cap=cv2.VideoCapture(str(target)); fps=cap.get(cv2.CAP_PROP_FPS) or 25; count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0); cap.release(); item.update(fps=fps,frame_count=count,duration=count/fps if fps else 0)
            except Exception: pass
        meta['items'][key]=item; added.append(key)
    meta['updated_at']=datetime.now().isoformat(); save_meta(name,meta); return jsonify(added=added,meta=meta)

@app.post('/api/projects/<name>/labels')
def labels(name):
    meta=load_meta(name); data=request.get_json() or {}; item=data.get('item')
    if item not in meta['items']: return jsonify(error='item not found'),404
    meta['items'][item]['labels']=data.get('labels',[]); meta['updated_at']=datetime.now().isoformat(); save_meta(name,meta); return jsonify(ok=True)

@app.get('/api/projects/<name>/video-info')
def video_info(name):
    meta=load_meta(name); video=request.args.get('video')
    if video not in meta['items'] or meta['items'][video]['type']!='video': return jsonify(error='video not found'),404
    it=meta['items'][video]; return jsonify(fps=it.get('fps',25),frame_count=it.get('frame_count',0),duration=it.get('duration',0),video=video)

@app.post('/api/projects/<name>/frames')
def frames(name):
    meta=load_meta(name); data=request.get_json() or {}; video=data.get('video'); mode=data.get('mode','all')
    if video not in meta['items'] or meta['items'][video]['type']!='video': return jsonify(error='video not found'),404
    try: import cv2
    except ImportError: return jsonify(error='opencv-python is required'),500
    cap=cv2.VideoCapture(str(pdir(name)/video)); total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0); fps=cap.get(cv2.CAP_PROP_FPS) or 25
    if total<=0: cap.release(); return jsonify(error='Could not read video'),400
    start=0 if mode=='all' else max(0,int(data.get('start',0))); end=total-1 if mode=='all' else min(total-1,int(data.get('end',total-1))); step=1 if mode=='all' else max(1,int(data.get('step',1)))
    if start>end: cap.release(); return jsonify(error='Invalid frame range'),400
    frame_dir=pdir(name)/'frames'; frame_dir.mkdir(exist_ok=True); base=Path(video).stem; wanted=set(range(start,end+1,step)); added=[]; i=0
    while i<=end:
        ok,frame=cap.read()
        if not ok: break
        if i in wanted:
            out=frame_dir/f'{base}_frame_{i:08d}.jpg'; key=out.relative_to(pdir(name)).as_posix()
            if not out.exists():
                cv2.imwrite(str(out),frame); h,w=frame.shape[:2]; meta['items'][key]={'type':'image','labels':[],'width':w,'height':h,'source_video':video,'frame':i,'fps':fps}; added.append(key)
        i+=1
    cap.release(); meta['updated_at']=datetime.now().isoformat(); save_meta(name,meta); return jsonify(added=added,count=len(added),start=start,end=end,step=step,total=total)

@app.post('/api/projects/<name>/import-yolo')
def import_yolo(name):
    meta=load_meta(name); d=pdir(name); f=request.files.get('dataset')
    if not f or not f.filename.lower().endswith('.zip'): return jsonify(error='Please upload a YOLO ZIP file'),400
    with tempfile.TemporaryDirectory() as td:
        zpath=Path(td)/'dataset.zip'; f.save(zpath)
        try:
            with zipfile.ZipFile(zpath) as z:
                if z.testzip() is not None: return jsonify(error='ZIP is corrupted'),400
                z.extractall(Path(td)/'unzipped')
        except zipfile.BadZipFile: return jsonify(error='Invalid ZIP file'),400
        root=Path(td)/'unzipped'; yaml_files=list(root.rglob('data.yaml'))
        yaml=yaml_files[0] if yaml_files else None
        # Simple YAML names parser without PyYAML dependency.
        if yaml:
            text=yaml.read_text(encoding='utf-8',errors='ignore')
            for line in text.splitlines():
                m=re.match(r'\s*(\d+)\s*:\s*["\']?(.*?)["\']?\s*$',line)
                if m and m.group(2) not in meta['classes']: meta['classes'].append(m.group(2).strip('"\''))
        imported=0
        for src in root.rglob('*'):
            if not src.is_file() or src.suffix.lower() not in IMAGE_EXT: continue
            # Avoid importing train/val duplicates twice if the same basename occurs; use unique project image number.
            idx=next_number(meta,'image'); dst=d/'images'/f'{idx:06d}{src.suffix.lower()}'; shutil.copy2(src,dst)
            key=dst.relative_to(d).as_posix()
            try:
                with Image.open(dst) as im: W,H=im.size
            except Exception: W=H=0
            label_candidates=[src.with_suffix('.txt'), src.parent.parent/'labels'/src.stem+'.txt', *root.rglob(src.stem+'.txt')]
            label_file=next((x for x in label_candidates if x.exists()),None)
            labs=[]
            if label_file:
                for line in label_file.read_text(encoding='utf-8',errors='ignore').splitlines():
                    q=line.split()
                    if len(q)<5: continue
                    cid=int(float(q[0])); vals=list(map(float,q[1:]));
                    if len(vals)==4:
                        cx,cy,bw,bh=vals; labs.append({'type':'box','class_id':cid,'x1':(cx-bw/2)*W,'y1':(cy-bh/2)*H,'x2':(cx+bw/2)*W,'y2':(cy+bh/2)*H})
                    elif len(vals)>=6 and len(vals)%2==0:
                        labs.append({'type':'polygon','class_id':cid,'points':[{'x':vals[i]*W,'y':vals[i+1]*H} for i in range(0,len(vals),2)]})
            meta['items'][key]={'type':'image','labels':labs,'width':W,'height':H,'original_name':src.name}; imported+=1
        meta['updated_at']=datetime.now().isoformat(); save_meta(name,meta)
        return jsonify(ok=True,imported=imported,meta=meta)

@app.get('/media/<name>/<path:rel>')
def media(name,rel):
    root=pdir(name).resolve(); f=(root/rel).resolve()
    if root not in f.parents or not f.exists(): abort(404)
    return send_file(f)

@app.post('/api/projects/<name>/export')
def export(name):
    meta=load_meta(name); data=request.get_json() or {}; val=max(0,min(.9,float(data.get('val',.2)))); seed=int(data.get('seed',42)); fmt=data.get('format','yolo_box')
    if fmt not in {'yolo_box','yolo_seg'}: return jsonify(error='Unknown export format'),400
    d=pdir(name); out=d/'export';
    if out.exists(): shutil.rmtree(out)
    for split in ('train','val'):
        (out/'images'/split).mkdir(parents=True); (out/'labels'/split).mkdir(parents=True)
    items=[(k,v) for k,v in meta['items'].items() if v.get('type')=='image' and v.get('labels')]
    random.Random(seed).shuffle(items); cut=round(len(items)*(1-val)); train,valid=items[:cut],items[cut:]
    for split,arr in [('train',train),('val',valid)]:
        for key,it in arr:
            src=d/key; dst=out/'images'/split/src.name; shutil.copy2(src,dst)
            W,H=it.get('width'),it.get('height')
            if not W or not H:
                with Image.open(src) as im: W,H=im.size
            lines=[]
            for b in it['labels']:
                cid=int(b.get('class_id',0)); typ=b.get('type','box')
                if fmt=='yolo_seg':
                    if typ=='polygon' and len(b.get('points',[]))>=3: pts=b['points']
                    else: pts=[{'x':b['x1'],'y':b['y1']},{'x':b['x2'],'y':b['y1']},{'x':b['x2'],'y':b['y2']},{'x':b['x1'],'y':b['y2']}]
                    vals=[]
                    for p in pts: vals += [fit01(p['x']/W),fit01(p['y']/H)]
                    lines.append(str(cid)+' '+' '.join(f'{v:.6f}' for v in vals))
                else:
                    if typ=='polygon':
                        xs=[p['x'] for p in b['points']]; ys=[p['y'] for p in b['points']]; x1,x2,y1,y2=min(xs),max(xs),min(ys),max(ys)
                    else: x1,y1,x2,y2=b['x1'],b['y1'],b['x2'],b['y2']
                    lines.append(f'{cid} {fit01((x1+x2)/2/W):.6f} {fit01((y1+y2)/2/H):.6f} {fit01((x2-x1)/W):.6f} {fit01((y2-y1)/H):.6f}')
            (out/'labels'/split/(src.stem+'.txt')).write_text('\n'.join(lines)+('\n' if lines else ''),encoding='utf-8')
    yaml='path: .\ntrain: images/train\nval: images/val\nnames:\n'+''.join(f'  {i}: {json.dumps(n,ensure_ascii=False)}\n' for i,n in enumerate(meta['classes']))
    (out/'data.yaml').write_text(yaml,encoding='utf-8')
    manifest={'project':meta['name'],'classes':meta['classes'],'total_labeled_images':len(items),'train':len(train),'val':len(valid),'format':fmt,'generated_at':datetime.now().isoformat()}
    (out/'dataset_info.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    zip_path=d/f'{safe_project(name)}_{fmt}_dataset.zip'
    tmp=d/f'.{zip_path.stem}_tmp.zip'
    if tmp.exists(): tmp.unlink()
    with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.rglob('*')):
            if f.is_file(): z.write(f,f.relative_to(out).as_posix())
    tmp.replace(zip_path)
    return send_file(zip_path,as_attachment=True,download_name=zip_path.name,mimetype='application/zip')

@app.post('/api/projects/<name>/delete')
def delete_project(name):
    d=pdir(name)
    if d.exists(): shutil.rmtree(d)
    return jsonify(ok=True)

if __name__=='__main__': app.run(host='127.0.0.1',port=8000,debug=False)
