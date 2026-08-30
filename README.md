# Game Factory Kit

`Game Factory Kit` — открытый набор инструкций, шаблонов и проверок для AI-агентов, которые помогают довести игровую идею до небольшого проверяемого билда.

Первая версия ориентирована на реальную работу соло-разработчика: она помогает зафиксировать core loop, удержать объём MVP, собрать GDD и технический план, разбить работу на milestones, реализовать тонкий игровой срез и честно отделить автоматические проверки от ручного плейтеста.

## Что уже есть в v0.1

- устанавливаемый скилл `$game-factory-kit`;
- режимы `Discover → Define → Plan → Build → Verify → Release`, в которые можно входить с любого нужного этапа;
- проверенные стартовые маршруты для Unity/C# и браузерных HTML-игр;
- расширяемый маршрут для Godot, Unreal и других движков после инспекции проекта;
- генератор компактного набора проектных документов;
- валидатор структуры и незаполненных шаблонов;
- пример на основе **Mage: Cleanse the Corruption**;
- автоматические тесты и GitHub Actions.

Скилл не обещает одной кнопкой сделать любую игру. Его задача — заставить агента двигаться к следующему наблюдаемому игровому результату, не раздувать объём и не выдавать компиляцию за готовую механику.

## Структура

```text
GameFactoryKit/
├── skills/game-factory-kit/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── references/
│   ├── scripts/
│   └── assets/project-template/
├── examples/mage-cleanse-corruption/
├── tests/
├── AGENTS.md
├── CONTRIBUTING.md
└── ROADMAP.md
```

## Установка скилла

Скопируйте папку `skills/game-factory-kit` в каталог скиллов агента:

```bash
cp -R skills/game-factory-kit ~/.codex/skills/game-factory-kit
```

После установки скилл можно вызвать явно:

```text
Use $game-factory-kit to turn my game idea into a scoped prototype milestone.
```

Автоматическое подключение также включено: агент сможет выбрать скилл для задач по концепту, планированию, реализации, проверке и передаче игрового проекта.

## Быстрый старт нового проекта

```bash
python3 skills/game-factory-kit/scripts/init_game_project.py \
  "My Game" \
  --output ./workspaces \
  --engine unity \
  --platform windows \
  --genre "action roguelite" \
  --stage prototype
```

Генератор создаст каталог с едиными источниками правды:

- `PROJECT.md` — текущий статус и границы объёма;
- `GAME_SPEC.yaml` — компактные факты для агента;
- `docs/GDD.md` и `docs/TECHNICAL_DESIGN.md`;
- `ROADMAP.md`, `BACKLOG.md`, `QA.md`, `DECISIONS.md`, `HANDOFF.md`.

Генератор не перезаписывает существующий каталог.

## Проверка проектного набора

```bash
python3 skills/game-factory-kit/scripts/validate_game_project.py \
  examples/mage-cleanse-corruption
```

## Проверка репозитория

```bash
python3 -m unittest discover -s tests -v
python3 /path/to/skill-creator/scripts/quick_validate.py \
  skills/game-factory-kit
```

Вторая команда использует стандартный валидатор среды Codex. В GitHub Actions выполняются автономные тесты репозитория, не требующие установленного Codex.

## Текущие границы

- В v0.1 подробно описаны Unity/C# и Web-маршруты; поддержка других движков пока считается адаптируемой, а не проверенной.
- Kit не заменяет редактор движка, плейтест, проверку лицензий и сборку на целевом устройстве.
- Шаблоны — рабочая стартовая точка. Они не должны превращаться в обязательную бюрократию для маленькой задачи.

## Следующие версии

План развития находится в [ROADMAP.md](ROADMAP.md). Предложения и небольшие улучшения можно оформлять по правилам из [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

MIT — см. [LICENSE](LICENSE).
