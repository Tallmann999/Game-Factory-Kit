# Проверка GLB
Скопируй каталог [assets/glb-audit](../assets/glb-audit) во временную папку инструментов проекта. В этой папке выполни `npm ci` (Node.js 22+). Вход — самодостаточный glTF 2.0 binary. Храни результаты в папке QA проекта.

```sh
node audit.mjs original.glb --out original.audit.json
node audit.mjs original.glb --optimize cleaned.glb --out comparison.json
node audit.mjs original.glb --after artist-optimized.glb --parts before-batching.glb --out comparison.json
```

Отчёт сохраняет сообщения и коды Khronos Validator, размер файла, треугольники по каждому мешу и примитиву, назначенные материалы, изображения и текстуры. Сумма относится к уникальным мешам файла. Инстансы и повторные проходы рендера влияют на фактическую нагрузку кадра. В режиме сравнения before и after имеют одинаковую схему; delta выражает after минус before. Ошибки валидации дают ненулевой код выхода. Предупреждения рассматривай отдельно.

`--optimize` запускает dedup и prune из glTF Transform и создаёт новый файл. Число треугольников может остаться прежним. Для авторских LOD, упрощения или сжатия другим инструментом передай готовый файл через `--after`. Для файлов, требующих специальных кодеков при повторном экспорте, используй этот режим.

Если кузов экспортирован одним мешем на материал, точное число треугольников отдельной дуги доступно только в исходных деталях. Для редактируемого файла Blender сохрани промежуточный GLB (команда создаёт новый файл из видимых мешей, исходный blend только читает):

```sh
blender -b source.blend --python-exit-code 1 -P export-parts.py -- before-batching.glb
```

Передай его через `--parts`; детали будут в `beforeBatching.meshes`. Пример для Sand3D: искать `One-piece nose guard`, а не приписывать целой группе металла стоимость бампера.

Источники: [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator), [glTF Transform](https://gltf-transform.dev/).
