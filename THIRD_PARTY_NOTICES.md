# Third-Party Notices

This file lists the licences of third-party packages that ship in the packaged
MMM app (Electron + Express + React), plus the licences/attributions of
external content used in the in-app "Learn" module.

Every claim below was read directly from the file on disk (`node_modules/<pkg>/package.json`
and the licence file in that package's directory) or from `content/learn/sources.yaml` — nothing
here is from memory. The path each fact was read from is noted per entry.

Only the packages listed in `package.json` `dependencies` are covered, plus `electron`: although
`electron` is listed under `devDependencies` in `package.json`, its runtime (`node_modules/electron/dist`)
is copied by `fs.cpSync` in `scripts/build-portable.mjs` into the shipped build as `MMM.exe`, so it
does ship and is covered below. Aside from that one exception, `devDependencies` are build-time
only and are not included. **Transitive dependencies (the dependencies of these packages) are not
individually listed in this file.**

---

## npm packages

### ts-fsrs
- Version: 5.4.2
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2026 Open Spaced Repetition`
- Read from: `node_modules/ts-fsrs/package.json` (license field), `node_modules/ts-fsrs/LICENSE`

### yahoo-finance2
- Version: 4.0.2
- Licence (SPDX): MIT
- Copyright: `Copyright 2021 Gadi Cohen`
- Read from: `node_modules/yahoo-finance2/package.json` (license field), `node_modules/yahoo-finance2/LICENSE`

### lightweight-charts
- Version: 5.2.1
- Licence (SPDX): Apache-2.0
- Copyright: `Copyright 2023 TradingView, Inc.`
- Read from: `node_modules/lightweight-charts/package.json` (license field), `node_modules/lightweight-charts/LICENSE`
- Attribution note: `node_modules/lightweight-charts/README.md` states this licence "requires
  specifying TradingView as the product creator" and asks that the "attribution notice" from a
  `NOTICE` file plus a link to <https://www.tradingview.com/> be added to any user-facing page.
  **No `NOTICE` file is present in `node_modules/lightweight-charts/` in this install** (checked:
  only `LICENSE` and `README.md` exist in that directory). Per the README's own instructions and
  the Apache-2.0 licence terms (which only require reproducing a NOTICE file if one is included
  in the distribution), the following attribution is provided in its place:

  > TradingView Lightweight Charts™ is created by and copyright TradingView, Inc. Learn more at
  > <https://www.tradingview.com/>.

### papaparse
- Version: 5.5.4
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2015 Matthew Holt`
- Read from: `node_modules/papaparse/package.json` (license field), `node_modules/papaparse/LICENSE`

### recharts
- Version: 3.9.0 (installed; `package.json` requests `^3.8.1`)
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2015-present recharts`
- Read from: `node_modules/recharts/package.json` (license field), `node_modules/recharts/LICENSE`

### @fontsource-variable/inter
- Version: 5.3.0
- Licence (SPDX): OFL-1.1
- Copyright: `Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)`
- Read from: `node_modules/@fontsource-variable/inter/package.json` (license field), `node_modules/@fontsource-variable/inter/LICENSE`
- Confirmed OFL: the LICENSE file's body is the SIL Open Font License, Version 1.1.

### @fontsource-variable/jetbrains-mono
- Version: 5.3.0
- Licence (SPDX): OFL-1.1
- Copyright: `Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) JetBrainsMono-Italic[wght].ttf: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)`
- Read from: `node_modules/@fontsource-variable/jetbrains-mono/package.json` (license field), `node_modules/@fontsource-variable/jetbrains-mono/LICENSE`
- Confirmed OFL: the LICENSE file's body is the SIL Open Font License, Version 1.1.

### @fontsource-variable/space-grotesk
- Version: 5.3.0
- Licence (SPDX): OFL-1.1
- Copyright: `Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)`
- Read from: `node_modules/@fontsource-variable/space-grotesk/package.json` (license field), `node_modules/@fontsource-variable/space-grotesk/LICENSE`
- Confirmed OFL: the LICENSE file's body is the SIL Open Font License, Version 1.1.

### @tailwindcss/vite
- Version: 4.3.2
- Licence (SPDX): MIT
- Copyright: `Copyright (c) Tailwind Labs, Inc.`
- Read from: `node_modules/@tailwindcss/vite/package.json` (license field), `node_modules/@tailwindcss/vite/LICENSE`

### @tanstack/react-query
- Version: 5.101.2
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2021-present Tanner Linsley`
- Read from: `node_modules/@tanstack/react-query/package.json` (license field), `node_modules/@tanstack/react-query/LICENSE`

### better-sqlite3
- Version: 12.11.1
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2017 Joshua Wise`
- Read from: `node_modules/better-sqlite3/package.json` (license field), `node_modules/better-sqlite3/LICENSE`

### compression
- Version: 1.8.1
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>` and `Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>`
- Read from: `node_modules/compression/package.json` (license field), `node_modules/compression/LICENSE`

### cors
- Version: 2.8.6
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2013 Troy Goode <troygoode@gmail.com>`
- Read from: `node_modules/cors/package.json` (license field), `node_modules/cors/LICENSE`

### dotenv
- Version: 16.6.1
- Licence (SPDX): BSD-2-Clause
- Copyright: `Copyright (c) 2015, Scott Motte`
- Read from: `node_modules/dotenv/package.json` (license field), `node_modules/dotenv/LICENSE`
- Note: dotenv is **not** MIT — its licence file on disk is a 2-clause BSD licence, distinct from
  every other package in this list.

### express
- Version: 4.22.2
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca>`, `Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com>`, `Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>`
- Read from: `node_modules/express/package.json` (license field), `node_modules/express/LICENSE`

### express-rate-limit
- Version: 7.5.1
- Licence (SPDX): MIT
- Copyright: `Copyright 2023 Nathan Friedly, Vedant K`
- Read from: `node_modules/express-rate-limit/package.json` (license field), `node_modules/express-rate-limit/license.md`

### helmet
- Version: 8.2.0
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2012-2026 Evan Hahn, Adam Baldwin`
- Read from: `node_modules/helmet/package.json` (license field), `node_modules/helmet/LICENSE`
- Note: the end year in the copyright line (2026) is what is actually printed in the licence
  file on disk; reproduced verbatim even though it is a forward-dated year.

### lucide-react
- Version: 1.22.0
- Licence (SPDX): ISC
- Copyright: `Copyright (c) 2026 Lucide Icons and Contributors`
- Read from: `node_modules/lucide-react/package.json` (license field), `node_modules/lucide-react/LICENSE`
- Note: the same LICENSE file also carries a second, MIT-licensed notice covering a subset of
  icons "derived from the Feather project": `Copyright (c) 2013-present Cole Bemis`. Both notices
  are reproduced in the ISC/MIT appendix entries below since they come from the same file.
  Also note the primary copyright year (2026) is forward-dated exactly as printed in the file.

### motion
- Version: 12.42.0
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2024 [Motion](https://motion.dev) B.V.`
- Read from: `node_modules/motion/package.json` (license field), `node_modules/motion/LICENSE.md`

### react
- Version: 18.3.1
- Licence (SPDX): MIT
- Copyright: `Copyright (c) Facebook, Inc. and its affiliates.`
- Read from: `node_modules/react/package.json` (license field), `node_modules/react/LICENSE`

### react-dom
- Version: 18.3.1
- Licence (SPDX): MIT
- Copyright: `Copyright (c) Facebook, Inc. and its affiliates.`
- Read from: `node_modules/react-dom/package.json` (license field), `node_modules/react-dom/LICENSE`

### react-grid-layout
- Version: 1.5.3
- Licence (SPDX): MIT
- Copyright: `Copyright (c) 2016 Samuel Reed`
- Read from: `node_modules/react-grid-layout/package.json` (license field), `node_modules/react-grid-layout/LICENSE`

### react-router-dom
- Version: 7.18.1
- Licence (SPDX): MIT
- Copyright: `Copyright (c) React Training LLC 2015-2019`, `Copyright (c) Remix Software Inc. 2020-2021`, `Copyright (c) Shopify Inc. 2022-2023`
- Read from: `node_modules/react-router-dom/package.json` (license field), `node_modules/react-router-dom/LICENSE.md`

### tailwindcss
- Version: 4.3.2
- Licence (SPDX): MIT
- Copyright: `Copyright (c) Tailwind Labs, Inc.`
- Read from: `node_modules/tailwindcss/package.json` (license field), `node_modules/tailwindcss/LICENSE`

### electron
- Version: 30.5.1
- Licence (SPDX): MIT
- Read from: `node_modules/electron/package.json` (license field). Listed as a `devDependency`, but its
  runtime is copied via `fs.cpSync(node_modules/electron/dist, ...)` in `scripts/build-portable.mjs`
  and ships as `MMM.exe` — see the note above the package list.
- Bundled Chromium notices: the Electron runtime embeds Chromium. Its `LICENSE` and
  `LICENSES.chromium.html` files (both confirmed present in `node_modules/electron/dist/`) are
  copied alongside `MMM.exe` in the packaged build by the same `fs.cpSync` call, so Chromium's
  third-party notices ship as `LICENSES.chromium.html` next to `MMM.exe` rather than being
  reproduced in this document.

---

## Licence text appendix

Full text of each distinct licence type used above, copied verbatim from one representative
package's licence file on disk (per-package copyright lines are listed in each entry above, not
repeated here).

### MIT License

Copied from `node_modules/react/LICENSE`:

```
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

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
```

### ISC License

Copied from `node_modules/lucide-react/LICENSE`:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

That same file also contains a secondary MIT notice covering a subset of icons derived from the
Feather project:

```
The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

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
```

### Apache License, Version 2.0

Copied from `node_modules/lightweight-charts/LICENSE`:

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2023 TradingView, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### SIL Open Font License, Version 1.1 (OFL-1.1)

Copied from `node_modules/@fontsource-variable/inter/LICENSE` (the licence body is identical
boilerplate in all three `@fontsource-variable/*` packages; only the leading per-font copyright
line differs, and each is listed under its own package entry above):

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### BSD 2-Clause License

Copied from `node_modules/dotenv/LICENSE`:

```
Copyright (c) 2015, Scott Motte
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Content sources (in-app "Learn" module)

The following is read verbatim from `content/learn/sources.yaml`, which every Learn lesson's
`source_id` front matter field points into. Per that file's own header comment, **Bogleheads is
deliberately excluded**: its licence is unverified, no lesson in modules M0-M2 cites it, and if a
future module wants to reference it the file's rule is to write original prose and link out —
never copy a sentence, and never set `allows_verbatim: true` for it.

### original-mmm
- Title: MMM app documentation (this product)
- URL: *(none listed)*
- Licence: Original — written for this app
- Attribution: "Written by the MMM team. No external source."

### cfpb-emergency-savings
- Title: Emergency savings / Your Money, Your Goals — Consumer Financial Protection Bureau
- URL: https://www.consumerfinance.gov/consumer-tools/save/emergency-savings/
- Licence: US Government Work — Public Domain
- Attribution: "Consumer Financial Protection Bureau (CFPB). U.S. federal government work, public domain."

### fdic-money-smart
- Title: Money Smart for Adults — Federal Deposit Insurance Corporation
- URL: https://www.fdic.gov/consumer-resource-center/money-smart
- Licence: US Government Work — Public Domain
- Attribution: "Federal Deposit Insurance Corporation (FDIC). U.S. federal government work, public domain."

### openstax-principles-of-finance-1e
- Title: Principles of Finance, 1st Edition — OpenStax (Dahlquist & Knight)
- URL: https://openstax.org/details/books/principles-finance
- Licence: CC BY 4.0
- Licence URL: https://creativecommons.org/licenses/by/4.0/
- Attribution: "Access for free at openstax.org. Principles of Finance (1st ed.) is licensed under CC BY 4.0. Adapted with modification for this lesson."

### wikipedia-emergency-fund
- Title: Emergency fund — Wikipedia
- URL: https://en.wikipedia.org/wiki/Emergency_fund
- Licence: CC BY-SA 4.0
- Licence URL: https://creativecommons.org/licenses/by-sa/4.0/
- Attribution: "Adapted from \"Emergency fund\" by Wikipedia contributors, CC BY-SA 4.0. Content has been modified from the original."

### wikipedia-fixed-variable-costs
- Title: Fixed cost / Variable cost — Wikipedia
- URL: https://en.wikipedia.org/wiki/Fixed_cost
- Licence: CC BY-SA 4.0
- Licence URL: https://creativecommons.org/licenses/by-sa/4.0/
- Attribution: "Adapted from \"Fixed cost\" by Wikipedia contributors, CC BY-SA 4.0. Content has been modified from the original."
