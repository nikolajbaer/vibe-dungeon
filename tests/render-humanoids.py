"""Offline turntable-style preview from actual Three.js skinned vertices."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / 'public' / 'characters'
actions = '--actions' in sys.argv
attack = '--attack' in sys.argv
combat = '--combat' in sys.argv
species = ['parry', 'unarmedStrike', 'chop'] if combat else ['attack', 'attack', 'attack'] if attack else ['idle', 'hit', 'death'] if actions else ['human', 'elf', 'goblin', 'dwarf']
data = [json.loads((root / (s + '-render.json')).read_text()) for s in species]
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(font_path, 23)
small = ImageFont.truetype(font_path, 16)
big = ImageFont.truetype(font_path, 32)
az = .70 if actions else .40
el = .24 if actions else .11
right = np.array([np.cos(az),0,-np.sin(az)])
up = np.array([-np.sin(az)*np.sin(el),np.cos(el),-np.cos(az)*np.sin(el)])
view = np.cross(right,up)
light = np.array([.4,.8,1.]);light /= np.linalg.norm(light)
images = []
for f in range(90 if combat else 100 if attack else 90 if actions else 32):
    im = Image.new('RGB',(1200,740),(23,29,39));draw=ImageDraw.Draw(im)
    draw.text((42,32),'HUMANOID / BASE 01',font=big,fill=(230,237,248))
    draw.text((43,79),'Parry / unarmed right cross / axe-mace chopping arc' if combat else 'One-handed short-sword stab / crouched guard / compact recovery' if attack else 'Loiter / Take damage / Death — actual rig animation' if actions else '1,580 triangles  /  23 bones  /  shared skeleton  /  walk cycle',font=small,fill=(152,173,200))
    for col,(s,d) in enumerate(zip(species,data)):
        if attack or combat:
            az = ([0,.85,0] if combat else [0,.85,1.57])[col]
            right=np.array([np.cos(az),0,-np.sin(az)])
            up=np.array([-np.sin(az)*np.sin(.12),np.cos(.12),-np.cos(az)*np.sin(.12)])
            view=np.cross(right,up)
        verts=np.array(d['frames'][f]);faces=np.array(d['indices']).reshape(-1,3)
        colors=np.array(d['colors']).reshape(-1,3)
        x0=(240+col*400) if attack or combat else (200+col*400) if actions else (155+col*297);ground=625;scale=225 if attack or combat else 250
        draw.ellipse((x0-67,ground-12,x0+67,ground+13),fill=(15,21,30))
        projected=np.stack([verts@right*scale+x0,ground-verts@up*scale],axis=1)
        depth=verts@view
        for face in sorted(faces,key=lambda t:depth[t].mean()):
            a,b,c=verts[face];normal=np.cross(b-a,c-a);length=np.linalg.norm(normal)
            if length<1e-10:continue
            normal/=length
            if normal@view<0:continue
            shade=.42+.65*max(0,normal@light)
            rgb=np.clip(colors[face].mean(axis=0)*shade,0,1)
            rgb=np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
            draw.polygon([tuple(v) for v in projected[face]],fill=tuple((rgb*255).astype(int)))
        label = ['PARRY','RIGHT CROSS','CHOP'][col] if combat else ['FRONT','THREE-QUARTER','SIDE'][col] if attack else {'idle':'LOITER','hit':'TAKE DAMAGE','death':'DEATH'}.get(s,s.upper())
        draw.text((x0-75,661),label,font=font,fill=(221,231,244))
    draw.text((43,710),'Actual skinned geometry · In-place animation · Prototype proportions and costume',font=small,fill=(137,155,181))
    images.append(im)
images[32 if combat else 32 if attack else 45 if actions else 0].save(root/('humanoid-combat.png' if combat else 'humanoid-attack.png' if attack else 'humanoid-actions.png' if actions else 'humanoid-lineup.png'))
output = root/('humanoid-combat.gif' if combat else 'humanoid-attack.gif' if attack else 'humanoid-actions.gif' if actions else 'humanoid-walk.gif')
images[0].save(output,save_all=True,append_images=images[1:],duration=67 if actions else 34,loop=0,optimize=False)
print(output)
