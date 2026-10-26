# Third-party notices

## Test fixture CSS

`tests/browser.html` contains a DSH 0.2.1-rc.2 composer CSS snapshot and a
Claude-style 0.19.1 composer CSS snapshot, adapted as a deterministic browser
fixture. The generated documentation previews render that fixture.

`docs/images/preview.png` and `docs/images/demo.gif` render that fixture with
mocked responses. `docs/images/desktop-install.png` is a native DSH installation
screen with a locally customized Claude-style theme. It identifies the installed
package; no theme engine, font files or mascot assets are redistributed with it.
Capture details are recorded in [the demo guide](docs/DEMO.md).

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness — MIT.
  Copyright (c) 2026 DeepSeek.
- dsh-claude-style: https://github.com/Nwflower/dsh-claude-style — the MIT
  portion of the 0.19.1 distribution. Copyright (c) 2026 Nwflower.

Only the fixture's composer stylesheet is included here. The theme's Sodium
engine, proprietary Anthropic fonts, mascot artwork and font files are not
included. Those separately licensed assets are not covered by this notice.
The fixture includes inline SVG shapes already present in the stylesheet.

The following MIT terms apply to each of the two notices above:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime and development dependencies

Dependencies are installed separately; they are not vendored into this
plugin's runtime tarball. Their own distributions carry their license texts.
The lockfile records the exact resolved versions.

| Package | Use | Declared license |
| --- | --- | --- |
| @deepseek-ai/schemastery | Runtime configuration schema | MIT |
| @deepseek-ai/cosmokit | Transitive runtime helper | MIT |
| @standard-schema/spec | Transitive schema contract | MIT |
| react / react-dom / scheduler | Host React peer and development fixture | MIT |
| esbuild | Development bundling | MIT |
| playwright / playwright-core | Browser tests and preview capture | Apache-2.0 |

Browser binaries downloaded for development are not redistributed in the
plugin archives and have their own third-party notices.

## Interaction and interoperability references

The similarly named community project
[dsh-composer-prediction](https://github.com/Amir-Bazylkhanov/dsh-composer-prediction)
(MIT) was consulted for interaction and coexistence behavior. Its package is
not installed or vendored by this project. Compatibility identifiers in the
client and tests deliberately keep its package name.

DeepSeek Harness, DeepSeek and other product names identify compatibility;
this project is not an official release or an endorsement by those projects.
