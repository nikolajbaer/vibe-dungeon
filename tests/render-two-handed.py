"""Offline renderer of actual baked Three.js skinned vertices, not concept art."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
root=Path('public/two-handed')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',15)
az=-.7;el=.16
right=np.array([np.cos(az),0,-np.sin(az)])
up=np.array([-np.sin(az)*np.sin(el),np.cos(el),-np.cos(az)*np.sin(el)])
view=np.cross(right,up);light=np.array([-.4,.8,1]);light/=np.linalg.norm(light)
for kind in (['javelin'] if '--javelin' in sys.argv else ['crossbow','javelin'] if '--ranged' in sys.argv else ['greatsword'] if '--greatsword' in sys.argv else ['quarterstaff','greatsword']):
 data=json.loads((root/f'{kind}.json').read_text());images=[]
 for f in range(72):
  im=Image.new('RGB',(400*len(data),720),(24,31,43));draw=ImageDraw.Draw(im)
  draw.text((30,22),kind.upper()+'  /  NPC ANIMATION STUDY',font=font,fill=(231,236,247))
  draw.text((30,55),'Actual game mesh + weapon | 3/4 view | realtime | forward is toward the right',font=small,fill=(166,186,212))
  for col,d in enumerate(data):
   verts=np.array(d['frames'][f]);faces=np.array(d['indices']).reshape(-1,3);colors=np.array(d['colors']).reshape(-1,3)
   x0=125+col*400;ground=615;scale=166
   draw.line((col*400+14,ground,col*400+385,ground),fill=(64,80,99),width=2)
   draw.ellipse((x0-55,ground-12,x0+67,ground+12),fill=(15,21,30))
   projected=np.stack([verts@right*scale+x0,ground-verts@up*scale],axis=1);depth=verts@view
   # Vectorized face normals / depth ordering keep export reasonably quick.
   tri=verts[faces];normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);length=np.linalg.norm(normal,axis=1);normal/=np.maximum(length[:,None],1e-10)
   rgb=np.clip(colors[faces].mean(axis=1)*(.5+.6*np.maximum(0,normal@light))[:,None],0,1)
   rgb=np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
   for idx in np.argsort(depth[faces].mean(axis=1)):
    if length[idx]<1e-10 or normal[idx]@view<0:continue
    draw.polygon([tuple(p) for p in projected[faces[idx]]],fill=tuple((rgb[idx]*255).astype(int)))
   draw.text((col*400+30,650),d['name'].upper()+(' / HOLD' if d['name']=='block' else f" / {d['duration']:.2f}s"),font=font,fill=(235,220,171))
  draw.text((30,690),'Preview only — no PR / no gameplay changes',font=small,fill=(164,179,201))
  images.append(im)
 stem=kind+'-passing-step' if '--greatsword' in sys.argv else kind
 images[27].save(root/f'{stem}.png')
 images[0].save(root/f'{stem}.gif',save_all=True,append_images=images[1:],duration=42,loop=0,optimize=True)
 print(root/f'{stem}.gif',flush=True)
