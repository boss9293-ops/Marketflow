import re

with open("frontend/src/components/watchlist_mvp/CenterPanel.tsx", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Remove briefs from props
text = re.sub(r'\s*briefsStatus,', '', text)
text = re.sub(r'\s*briefsError,', '', text)
text = re.sub(r'\s*briefs,', '', text)
text = re.sub(r'\s*openClosePriceLabels,', '', text)

# Remove them from CenterPanelProps as well if they exist
text = re.sub(r'\s*briefsStatus:\s*SectionStatus', '', text)
text = re.sub(r'\s*briefsError:\s*string\s*\|\s*null', '', text)
text = re.sub(r'\s*briefs:\s*BriefItem\[\]', '', text)
text = re.sub(r'\s*openClosePriceLabels:\s*\{.*?\}', '', text, flags=re.DOTALL)

# Add selectedItem to CenterPanelProps
if 'selectedItem:' not in text:
    text = text.replace('selectedSymbol: string', 'selectedSymbol: string\n  selectedItem: {\n    symbol: string\n    lastPrice: string\n    changePercent: string\n    rangeLabel: string\n  } | null')
if 'selectedItem,' not in text:
    text = text.replace('  selectedSymbol,\n', '  selectedSymbol,\n  selectedItem,\n')

# Add missing import for NarrativeBlocks
if 'NarrativeBlocks' not in text:
    text = text.replace("import {", "import { NarrativeBlocks } from '@/components/narrative/NarrativeBlocks'\nimport {", 1)


# 2. Replace briefs render block with NarrativeBlocks
briefs_block_regex = r'\{\s*briefsStatus === \'loading\'\s*&&\s*\(.*?\}\)\s*\}'
# Actually let's just find the first <div> inside styles.stack
stack_inner = re.search(r'(<div className=\{styles\.stack\}>\s*)<div>([\s\S]*?)</div>(\s*<div>\s*\{timelineStatus)', text)
if stack_inner:
    # Replace the whole first div contents
    narrative_replacement = """
            <div className={styles.dailyDateBoundary}>
              <p className={styles.timelineDateHeader}>{formatTimelineDateHeader(dateET)}</p>
            </div>
            {narrative ? (
              <NarrativeBlocks data={narrative} density="compact" />
            ) : (
              <div className={styles.panelStateBox}>Narrative is unavailable.</div>
            )}
"""
    # Replace the blocks
    text = text[:stack_inner.start(2)] + narrative_replacement + text[stack_inner.end(2):]

# 3. Update timeline rendering to add tickerPrefix and 5-line CSS
# First, insert tickerPrefix above return
if 'const tickerPrefix' not in text:
    text = text.replace('return (\n    <section className={`${styles.panel} ${styles.centerPanel}`}>', 'const tickerPrefix = selectedItem ? `${selectedItem.symbol} ${selectedItem.lastPrice}` : selectedSymbol;\n\n  return (\n    <section className={`${styles.panel} ${styles.centerPanel}`}>')

# Update sort to localeCompare
text = text.replace("items: [...items].sort((a, b) => parseNewsTs(b.publishedAtET) - parseNewsTs(a.publishedAtET)).slice(0, 2),", "items: [...items].sort((a, b) => b.publishedAtET.localeCompare(a.publishedAtET)),")

# Update timelineHeadline
old_headline = "<p className={styles.timelineHeadline}>{item.headline}</p>"
new_headline = "<p className={styles.timelineHeadline}><strong style={{ color: '#ebf4ff', marginRight: '6px' }}>{tickerPrefix}</strong> <span style={{ color: '#89a0bb' }}>-</span> {item.headline}</p>"
text = text.replace(old_headline, new_headline)

with open("frontend/src/components/watchlist_mvp/CenterPanel.tsx", "w", encoding="utf-8") as f:
    f.write(text)
