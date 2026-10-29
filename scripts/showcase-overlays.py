from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import os
root=Path(__file__).resolve().parent.parent
folder=root/'evidence/showcase';folder.mkdir(parents=True,exist_ok=True)
candidates=[os.getenv('SHOWCASE_FONT',''),'/System/Library/Fonts/Supplemental/Arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
font_path=next((p for p in candidates if p and Path(p).exists()),None)
def font(size):return ImageFont.truetype(font_path,size) if font_path else ImageFont.load_default(size=size)
def make(name,title,labels=None):
 im=Image.new('RGBA',(1280,880));d=ImageDraw.Draw(im)
 d.rectangle((0,0,1280,58),fill=(11,18,26,230));d.text((24,15),'ZHUDA / '+title,font=font(24),fill='white')
 d.rectangle((0,846,1280,880),fill=(11,18,26,220));d.text((24,854),'100 EFFECTS  /  2D + 3D  /  WEBGL  /  60 FPS CAPTURE',font=font(16),fill=(186,220,214,255))
 if labels:
  d.line((639,58,639,846),fill=(73,100,113,255),width=2);d.line((0,439,1280,439),fill=(73,100,113,255),width=2)
  for i,label in enumerate(labels):
   x=20+(i%2)*640;y=71+(i//2)*440
   d.rectangle((x-7,y-4,x+330,y+25),fill=(11,18,26,180));d.text((x,y),label,font=font(18),fill='white')
 im.save(folder/(name+'-overlay.png'))
for mode in ['chase','side','front']:make(mode,'BODY-WRAPPING AIRFLOW / '+mode.upper())
make('magic','MAGIC IN MOTION',['PORTAL / RUNE GATE','HOLY / LIGHT COLUMN','VORTEX / ATTRACTION','HEALING / RESTORATION'])
make('impact','IMPACT / BURST / AFTERMATH',['FIREBALL / HIT','CRITICAL / FLASH','FROST / SHATTER','3D / SPHERICAL EXPLOSION'])
