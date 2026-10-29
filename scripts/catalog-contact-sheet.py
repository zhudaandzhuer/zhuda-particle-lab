import json, os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageChops
root=Path(__file__).resolve().parent.parent
entries=json.loads((root/'assets/effects/catalog.json').read_text())['entries']
folder=root/'evidence/catalog'
font=ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc',17)
small=ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc',13)
results=[]
for e in entries:
 a=Image.open(folder/(e['id']+'.png')).convert('RGB');b=Image.open(folder/(e['id']+'-off.png')).convert('RGB')
 d=ImageChops.difference(a,b);mask=d.convert('L').point(lambda v:255 if v>4 else 0)
 count=mask.histogram()[255];results.append({'id':e['id'],'changedPixels':count,'imagePixels':a.width*a.height,'bbox':mask.getbbox()})
for page in range(4):
 sheet=Image.new('RGB',(1600,5*255+64),'#0c1218');draw=ImageDraw.Draw(sheet)
 draw.text((20,20),f'ZHUDA PARTICLE LAB  /  {page*25+1:03}—{page*25+25:03}  /  100 SCENES',font=font,fill='#a3efcf')
 for i,e in enumerate(entries[page*25:page*25+25]):
  x=i%5*320;y=i//5*255+64
  img=Image.open(folder/(e['id']+'.png')).convert('RGB');img.thumbnail((312,215));sheet.paste(img,(x+4,y))
  draw.text((x+9,y+218),f'{e["number"]:03}  {e["title"]}',font=font,fill='#e8f1f4')
 sheet.save(root/f'evidence/catalog-sheet-{page+1}.jpg',quality=92)
(root/'evidence/catalog-pixel-report.json').write_text(json.dumps(results,indent=2))
print('Visible pixel changes (smallest first):',sorted([(r['id'],r['changedPixels']) for r in results],key=lambda p:p[1])[:12])
assert all(r['changedPixels']>50 for r in results),'An effect has no visible pixels'
# A browsable visual index uses the same captured WebGL output as the acceptance evidence.
from html import escape
thumbs=root/'public/thumbnails';thumbs.mkdir(exist_ok=True)
for e in entries:
 img=Image.open(folder/(e['id']+'.png')).convert('RGB');img.thumbnail((400,275));img.save(thumbs/(e['id']+'.webp'),quality=86)
manifest=json.loads((root/'assets/effects/catalog.json').read_text())
parts=['''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>100 種效果圖鑑 · Zhuda</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0c1218;color:#e8f1f4;font:14px 'Avenir Next','PingFang TC',sans-serif}main{max-width:1440px;margin:auto;padding:38px 30px}a{color:#a3efcf;text-decoration:none}h1{font-size:28px;font-weight:500;letter-spacing:2px}p{color:#8b9daa;line-height:1.7}nav{display:flex;gap:10px;flex-wrap:wrap;margin:28px 0}nav a{padding:9px 13px;border:1px solid #27333c;font-size:12px;border-radius:3px}h2{font-size:17px;font-weight:500;margin:36px 0 20px;scroll-margin-top:24px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}.card{border:1px solid #27333c;background:#141d25;border-radius:4px;overflow:hidden;color:#e8f1f4}.card:hover{border-color:#a3efcf}.card img{width:100%;aspect-ratio:960/660;object-fit:cover;display:block}.card strong{font-size:12px;font-weight:500;display:block;padding:12px 12px 0}.card p{font-size:10px;padding:0 12px;margin:8px 0 14px}.meta{color:#a3efcf;font-size:10px;margin-left:5px}@media(max-width:1000px){.grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){main{padding:25px 16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}
</style><main><a href="./">← 返回粒子實驗室</a><h1>100 種實用場景粒子</h1><p>10 個分類 · 91 種 2D + 9 種 3D<br>每張圖取自實際播放畫面。點選效果，開啟動態預覽並調整參數。</p><nav>''']
for c in manifest['categories']:parts.append(f'<a href="#{c["id"]}">{escape(c["title"])}</a>')
parts.append('</nav>')
for c in manifest['categories']:
 parts.append(f'<h2 id="{c["id"]}">{escape(c["title"])} <span class="meta">10 EFFECTS</span></h2><div class="grid">')
 for e in [e for e in entries if e['category']==c['id']]:
  parts.append(f'<a class="card" href="./?effect={e["id"]}"><img loading="lazy" src="thumbnails/{e["id"]}.webp" alt="{escape(e["title"])}"><strong>{e["number"]:03} / {escape(e["title"])}<span class="meta">{e["dimension"]}D</span></strong><p>{escape(e["usecase"])}</p></a>')
 parts.append('</div>')
parts.append('</main></html>')
(root/'public/catalog.html').write_text(''.join(parts))
print('Generated 100 thumbnails and visual index.')
