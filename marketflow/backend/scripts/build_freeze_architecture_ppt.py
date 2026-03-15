from __future__ import annotations

import datetime as dt
import os
import zipfile
from xml.sax.saxutils import escape


EMU_PER_INCH = 914400
SLIDE_W = 10 * EMU_PER_INCH
SLIDE_H = int(7.5 * EMU_PER_INCH)


def _p(paragraph: str, size: int = 1600, bold: bool = False, color: str = "E5E7EB") -> str:
    b = ' b="1"' if bold else ""
    return (
        f'<a:p><a:r><a:rPr lang="ko-KR" sz="{size}"{b}>'
        f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'
        f"</a:rPr><a:t>{escape(paragraph)}</a:t></a:r></a:p>"
    )


def _rect_shape(shape_id: int, name: str, x: int, y: int, cx: int, cy: int, fill: str, ln: str = "374151", text_ps: str = "") -> str:
    return f"""
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
        <p:cNvSpPr/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
        <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="{ln}"/></a:solidFill></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" lIns="91440" tIns="68580" rIns="91440" bIns="68580" anchor="ctr"/>
        <a:lstStyle/>
        {text_ps}
      </p:txBody>
    </p:sp>
    """


def _text_shape(shape_id: int, name: str, x: int, y: int, cx: int, cy: int, text_ps: str) -> str:
    return f"""
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="{shape_id}" name="{escape(name)}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" lIns="45720" tIns="22860" rIns="45720" bIns="22860"/>
        <a:lstStyle/>
        {text_ps}
      </p:txBody>
    </p:sp>
    """


def _slide_xml(title: str, shapes: str) -> str:
    title_box = _text_shape(
        2, "Title", int(0.3 * EMU_PER_INCH), int(0.15 * EMU_PER_INCH),
        int(9.4 * EMU_PER_INCH), int(0.7 * EMU_PER_INCH),
        _p(title, size=3600, bold=True, color="F9FAFB"),
    )
    bg = _rect_shape(
        1, "Background",
        0, 0, SLIDE_W, SLIDE_H,
        fill="0B0F14", ln="0B0F14", text_ps=_p("", size=1000, color="0B0F14")
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="0" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      {bg}
      {title_box}
      {shapes}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"""


def _slide_a() -> str:
    x = int(0.7 * EMU_PER_INCH)
    w = int(4.8 * EMU_PER_INCH)
    h = int(0.72 * EMU_PER_INCH)
    y0 = int(1.45 * EMU_PER_INCH)
    gap = int(0.52 * EMU_PER_INCH)

    boxes = [
        ("L0 Data Layer", "신뢰 소스 집계(FRED/Market)", "판단 생성 안함", "1E293B"),
        ("L1 Macro Sensor (Macro Room)", "환경 압력(유동성/금리/변동성)", "매수/매도 결정 안함", "0F2744"),
        ("L2 Market Health (Structure)", "내부 체력(확산/참여)", "행동 지시 안함", "1F2937"),
        ("L3 Market State (Regime)", "국면 진단명", "가격 목표 제시 안함", "2D1E3B"),
        ("L4 Risk Engine (Action)", "노출 상단/속도 제한", "장기 전략 재정의 안함", "3A1F2A"),
        ("L5 Portfolio Room", "계좌/전략 실행 레이어", "센서 계산 재정의 안함", "1F2937"),
    ]

    shapes = []
    sid = 10
    for i, (t, d, n, fill) in enumerate(boxes):
        y = y0 + i * (h + gap)
        txt = _p(t, 1800, True, "F8FAFC") + _p(d, 1300, False, "CBD5E1") + _p(f"Does NOT: {n}", 1100, False, "94A3B8")
        shapes.append(_rect_shape(sid, t, x, y, w, h, fill, "475569", txt))
        sid += 1
        if i < len(boxes) - 1:
            ay = y + h
            arrows = _text_shape(sid, f"arrow{i}", x + int(2.2 * EMU_PER_INCH), ay + int(0.02 * EMU_PER_INCH), int(0.5 * EMU_PER_INCH), int(0.3 * EMU_PER_INCH), _p("↓", 2200, True, "94A3B8"))
            shapes.append(arrows)
            sid += 1

    overlay_text = (
        _p("L6 Market Context (Daily Brief)", 1800, True, "F8FAFC")
        + _p("해석 전용(읽기 전용) · Tone: Constructive / Neutral / Cautious / Defensive / Uncertain", 1200, False, "C7D2FE")
        + _p("No prediction · no buy/sell", 1100, False, "93C5FD")
    )
    shapes.append(_rect_shape(90, "Overlay", int(0.6 * EMU_PER_INCH), int(0.8 * EMU_PER_INCH), int(6.2 * EMU_PER_INCH), int(0.62 * EMU_PER_INCH), "172554", "3B82F6", overlay_text))

    for i in range(4):
        sy = y0 + i * (h + gap) + int(0.2 * EMU_PER_INCH)
        shapes.append(_text_shape(100 + i, f"dotted{i}", int(6.0 * EMU_PER_INCH), sy, int(0.6 * EMU_PER_INCH), int(0.3 * EMU_PER_INCH), _p("⋯⋯", 1600, False, "64748B")))

    vr = (
        _p("VR Room (Crash Override / Strategy)", 1700, True, "F8FAFC")
        + _p("독립 전략 방 · 장기 풀 & 리플레이", 1200, False, "FECACA")
        + _p("No mixing with Macro/State signals", 1100, False, "FDA4AF")
    )
    shapes.append(_rect_shape(120, "VR", int(7.0 * EMU_PER_INCH), int(2.2 * EMU_PER_INCH), int(2.5 * EMU_PER_INCH), int(1.7 * EMU_PER_INCH), "3F1D2E", "9F1239", vr))
    shapes.append(_text_shape(121, "divider", int(6.75 * EMU_PER_INCH), int(1.55 * EMU_PER_INCH), int(0.1 * EMU_PER_INCH), int(4.5 * EMU_PER_INCH), _p("|", 4400, False, "475569")))

    return _slide_xml("MarketFlow Architecture (Freeze v1.0)", "".join(shapes))


def _slide_b() -> str:
    shapes = []
    header = _rect_shape(
        10, "header", int(0.6 * EMU_PER_INCH), int(1.0 * EMU_PER_INCH), int(8.8 * EMU_PER_INCH), int(0.55 * EMU_PER_INCH),
        "111827", "374151",
        _p("Layer", 1600, True, "E2E8F0") + _p("What it measures / What it does NOT decide", 1400, False, "94A3B8")
    )
    shapes.append(header)

    rows = [
        ("L0 Data", "측정 대상: 원천 데이터 정합성/업데이트\n결정 제외: 해석/판단/행동 생성"),
        ("L1 Macro", "측정 대상: 환경 압력(유동성/금리/변동성)\n결정 제외: 매수/매도 지시"),
        ("L2 Health", "측정 대상: 내부 체력(확산/참여)\n결정 제외: 실행 타이밍 단정"),
        ("L3 State", "측정 대상: 국면 진단명/상태 분류\n결정 제외: 포지션 크기 결정"),
        ("L4 Risk Engine", "측정 대상: 노출 상단/속도 제한\n결정 제외: 종목 선택"),
        ("L5 Portfolio", "측정 대상: 계좌/전략 운용\n결정 제외: 센서 로직 변경"),
        ("L6 Context", "측정 대상: 오늘 분위기 브리핑(해석 전용)\n결정 제외: 알림/신호 생성"),
        ("VR Room", "측정 대상: 독립 전략/리플레이\n결정 제외: Macro/State 신호와 혼합"),
    ]

    y = int(1.65 * EMU_PER_INCH)
    row_h = int(0.66 * EMU_PER_INCH)
    for i, (l, r) in enumerate(rows):
        fill = "0F172A" if i % 2 == 0 else "111827"
        left = _rect_shape(30 + i * 2, f"l{i}", int(0.6 * EMU_PER_INCH), y, int(2.0 * EMU_PER_INCH), row_h, fill, "334155", _p(l, 1400, True, "E5E7EB"))
        right_ps = []
        for line in r.split("\n"):
            right_ps.append(_p(f"• {line}", 1250, False, "CBD5E1"))
        right = _rect_shape(31 + i * 2, f"r{i}", int(2.65 * EMU_PER_INCH), y, int(6.75 * EMU_PER_INCH), row_h, fill, "334155", "".join(right_ps))
        shapes.append(left)
        shapes.append(right)
        y += row_h + int(0.05 * EMU_PER_INCH)

    return _slide_xml("Layer Meaning & Boundaries", "".join(shapes))


def _slide_c() -> str:
    shapes = []
    groups = [
        ("MARKET OS", ["Market Context", "Market State", "Market Health", "Macro", "Opportunity (VCP)", "Sectors"], "1E293B", "60A5FA"),
        ("ACTION", ["Risk Engine"], "1F2937", "F59E0B"),
        ("STRATEGY ROOMS", ["Portfolio", "VR Room"], "3F1D2E", "FB7185"),
    ]

    x = int(0.9 * EMU_PER_INCH)
    y = int(1.3 * EMU_PER_INCH)
    for i, (title, items, fill, accent) in enumerate(groups):
        h = int((0.75 + len(items) * 0.33) * EMU_PER_INCH)
        txt = _p(title, 1700, True, accent)
        for it in items:
            txt += _p(f"• {it}", 1350, False, "E5E7EB")
        shapes.append(_rect_shape(10 + i, f"grp{i}", x, y, int(8.2 * EMU_PER_INCH), h, fill, "334155", txt))
        y += h + int(0.28 * EMU_PER_INCH)

    note = _text_shape(
        40, "note",
        int(0.9 * EMU_PER_INCH), int(6.5 * EMU_PER_INCH),
        int(8.3 * EMU_PER_INCH), int(0.5 * EMU_PER_INCH),
        _p("Freeze v1.0: UI labeling alignment only. System logic unchanged.", 1200, False, "94A3B8"),
    )
    shapes.append(note)
    return _slide_xml("Sidebar Mapping (Final)", "".join(shapes))


def _content_types(slides: int) -> str:
    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
        '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
        '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
        '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
    ]
    for i in range(1, slides + 1):
        overrides.append(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {''.join(overrides)}
</Types>"""


def _presentation_xml(slides: int) -> str:
    sld_ids = []
    rel_start = 2
    for i in range(1, slides + 1):
        sld_ids.append(f'<p:sldId id="{255 + i}" r:id="rId{rel_start + (i - 1)}"/>')
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>{''.join(sld_ids)}</p:sldIdLst>
  <p:sldSz cx="{SLIDE_W}" cy="{SLIDE_H}" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>"""


def _presentation_rels(slides: int) -> str:
    rels = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
    ]
    for i in range(1, slides + 1):
        rels.append(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>')
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {''.join(rels)}
</Relationships>"""


SLIDE_LAYOUT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"""


SLIDE_MASTER = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>"""


THEME = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="E5E7EB"/></a:lt2>
      <a:accent1><a:srgbClr val="3B82F6"/></a:accent1><a:accent2><a:srgbClr val="10B981"/></a:accent2>
      <a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="FB7185"/></a:accent4>
      <a:accent5><a:srgbClr val="94A3B8"/></a:accent5><a:accent6><a:srgbClr val="6366F1"/></a:accent6>
      <a:hlink><a:srgbClr val="60A5FA"/></a:hlink><a:folHlink><a:srgbClr val="A78BFA"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
  </a:themeElements>
</a:theme>"""


ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""


def build_pptx(output_path: str) -> None:
    slides = [_slide_a(), _slide_b(), _slide_c()]
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    now = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _content_types(len(slides)))
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("docProps/app.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MarketFlow</Application><Slides>3</Slides></Properties>""")
        z.writestr("docProps/core.xml", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>MarketFlow Freeze v1.0 Architecture</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>""")

        z.writestr("ppt/presentation.xml", _presentation_xml(len(slides)))
        z.writestr("ppt/_rels/presentation.xml.rels", _presentation_rels(len(slides)))
        z.writestr("ppt/presProps.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>""")
        z.writestr("ppt/viewProps.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>""")
        z.writestr("ppt/tableStyles.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def=""/>""")
        z.writestr("ppt/theme/theme1.xml", THEME)
        z.writestr("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER)
        z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>""")
        z.writestr("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT)
        z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>""")

        for i, s in enumerate(slides, start=1):
            z.writestr(f"ppt/slides/slide{i}.xml", s)
            z.writestr(
                f"ppt/slides/_rels/slide{i}.xml.rels",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>""",
            )


if __name__ == "__main__":
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    out = os.path.join(repo_root, "docs", "MarketFlow_Architecture_Freeze_v1_0.pptx")
    build_pptx(out)
    print(out)
