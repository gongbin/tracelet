# KiCad standard 3D models

These model assets are derived from the KiCad standard 3D library, distributed under **CC BY-SA 4.0 with the KiCad libraries exception**, separately from Tracelet's MIT source code.

- Library: https://gitlab.com/kicad/libraries/kicad-packages3D
- License and exception: https://www.kicad.org/libraries/license/
- CC BY-SA 4.0 legal text: https://creativecommons.org/licenses/by-sa/4.0/legalcode
- Each `<model>.notice.txt` retains the source STEP header, copyright notices and source URL.
- `manifest.json` records the original model path.

Changes by Tracelet contributors (2026): STEP geometry tessellated into GLB with KiCad 10.0.6, dummy PCB offset removed, model provenance attached. These converted model assets retain the same library license. This collection is not relicensed under MIT.

The KiCad exception allows use in electronic designs without requiring those designs to adopt the library license. Redistribution of the model collection itself remains subject to the library license.

Models describe standard packages, not guaranteed manufacturer-specific dimensions. Verify critical mechanical dimensions against the component datasheet.

Rebuild: `python3 scripts/build-kicad-models.py` with KiCad 10 installed. Override `KICAD_CLI` and `KICAD_MODELS` for other installation paths. No private board data is used by the converter.
