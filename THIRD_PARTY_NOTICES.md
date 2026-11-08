# Происхождение и лицензии

Проверка: 26 октября 2026. Лицензия корня относится к новым инструкциям и инструментам Game Studio Kit; сторонние файлы сохраняют условия ниже. LICENSE/NOTICE находятся также внутри устанавливаемых skill-папок, чтобы сохраняться при переносе профиля.

| Папки | Источник и снимок | Условия | Изменения в наборе |
|---|---|---|---|
| `game-roblox-ui` | UI_STYLES v0.9, UI_SPEC_TEMPLATE v0.6, UI_GENERATION_GUIDE_DRAFT v0.10 — материалы, предоставленные автором проекта 6 ноября 2026 для включения в набор | Включены по поручению автора; оболочка скилла и скрипт подготовки — MIT набора | Сохранены правила и версии; ссылки на отсутствующий личный файл замечаний заменены на включённый список UI-01–UI-11 |
| `scenario-roblox-expert`, `scenario-roblox-performance` | [scenario-labs/skills](https://github.com/scenario-labs/skills/tree/b96506d77c8595a4fe9c66eddb0bf9b5953a1d45/skills/game-engines/roblox), commit `b96506d77c8595a4fe9c66eddb0bf9b5953a1d45` | MIT, ©2026 Scenario Inc. | Инструкции и скрипты с копией upstream LICENSE в каждом навыке. Часть помощников Studio рассчитана на macOS. |
| 14 `game-*` | Оригинальные рабочие инструкции Game Studio Kit 0.1.0 | MIT, ©2026 Game Studio Kit contributors | Новые файлы |
| 22 `blender-*` | [EL4CTEO/blender-skills](https://github.com/EL4CTEO/blender-skills/tree/71d031dab8bc6729504d11a78cbe91945401045f), commit `71d031dab8bc6729504d11a78cbe91945401045f` | MIT, ©2026 EL4CTEO | Только skills из закреплённого архива; добавлена копия upstream LICENSE в каждую папку. В blender-core поле compatibility перемещено в metadata для совместимости с локальным skill-creator validator |
| 7 `phaser-*` | [phaserjs/phaser/skills](https://github.com/phaserjs/phaser/tree/02d8931b626d9764c133cbb3fbf99966c03c757c/skills), локальный лицензированный snapshot с записанным ref `02d8931b626d9764c133cbb3fbf99966c03c757c` | MIT, ©2026 Richard Davey / Phaser Studio Inc. | Сохранены локальные префиксы `phaser-`; LICENSE.md в каждой папке. Это snapshot, не новое скачивание всего движка |
| `unity-mcp-orchestrator` | [CoplayDev/unity-mcp/unity-mcp-skill](https://github.com/CoplayDev/unity-mcp/tree/81542a7e86292b5c4c21b1782c5af23b567f45ce/unity-mcp-skill), локальный snapshot с записанным ref `81542a7e86292b5c4c21b1782c5af23b567f45ce` | MIT, ©2025 CoplayDev | Сохранён локальный snapshot и LICENSE. Сервер/Editor package не включены |
| `playwright` | [openai/skills](https://github.com/openai/skills/tree/main/skills/.curated/playwright), локальный лицензированный snapshot; исходный commit не записан. NOTICE указывает производные материалы microsoft/playwright-cli | Apache-2.0; сохранены LICENSE.txt и NOTICE.txt, ©Microsoft Corporation | Скорректированы SKILL.md и примеры references: реальные пути установки, доступный browser workflow, Windows без обязательного bash; вызов wrapper через bash не зависит от executable bit ZIP; убрана обязательная глобальная установка; добавлены записи в NOTICE |

SHA256 загруженного Blender source ZIP: `d97e841954dc05b1ee73a2934f22f4af9a6f55cc525485fc7cda1ad1dd64ad68`. Это хеш источника, не хеш итогового релиза. Для локальных snapshots ref — записанное происхождение из каталога, а не заявление о побайтовом совпадении с upstream.

## Только ссылки и оценка, без копирования

- [dim-s/indie-gamedev-knowledge-base](https://github.com/dim-s/indie-gamedev-knowledge-base/tree/5e410f4ce7732f3b74f95a2cb60f54e4943a0404), ©2026 Dmitrii Zaitsev (Зайцев Дмитрий Геннадьевич), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Материалы/OGD-skill не включены. В docs дан самостоятельный обзор с атрибуцией и ссылками; это не утверждение об одобрении автором набора.
- Девять локальных Web Game Studio навыков из [openai/plugins](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/game-studio) не скопированы: в проверенных корне и папке плагина не найдена лицензия для раздачи. Их возможности покрывают новые компактные игровые роли; сохранённая пользовательская коллекция остаётся вне этого репозитория.
- RobloxGameKit, локальные GD/kickoff/converter/handoff wrappers, reverse engineering и `.system` не включены. Это не оценка их бесполезности: часть требует перепаковки/проверки прав и зависимостей, часть относится к другой задаче. Таблица решений — в LOCAL_SKILLS_AUDIT.md.

Лицензия приложения Blender, движков и любых подключаемых служб действует отдельно от условий этих инструкций. Лицензии игровых ассетов проверяются для каждого фактически используемого файла.
