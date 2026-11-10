"""Run on an editable source blend in a separate background Blender instance."""
import sys
from pathlib import Path
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
if len(args) != 1:
    raise ValueError('Supply one new output .glb path after --')
target = Path(args[0]).resolve()
if target.suffix.lower() != '.glb' or target.exists():
    raise ValueError('Choose a new .glb file')
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.visible_objects:
    if obj.type == 'MESH':
        obj.select_set(True)
if not bpy.context.selected_objects:
    raise ValueError('No visible mesh parts to export')
result = bpy.ops.export_scene.gltf(filepath=str(target),use_selection=True,export_apply=True)
if result != {'FINISHED'}:
    raise RuntimeError(str(result))
