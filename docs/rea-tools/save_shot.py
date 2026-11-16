import json,sys,base64
d=json.load(open(sys.argv[1])); a=d['normalized_result']['artifact']
def find(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if isinstance(v,str) and len(v)>1000: return v
            r=find(v)
            if r: return r
    if isinstance(o,list):
        for v in o:
            r=find(v)
            if r: return r
b=find(a)
open(sys.argv[2],'wb').write(base64.b64decode(b.split(',')[-1]))
print(d['evidence_id'], {k:v for k,v in a.items() if not (isinstance(v,str) and len(v)>1000)}, d['normalized_result']['viewport'])
