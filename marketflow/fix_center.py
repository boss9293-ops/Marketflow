with open("frontend/src/components/watchlist_mvp/CenterPanel.tsx", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Add selectedItem to props
text = text.replace("  selectedSymbol,", "  selectedSymbol,\n  selectedItem,")

# 2. Modify parseNewsTs
old_sort = "items: [...items].sort((a, b) => parseNewsTs(b.publishedAtET) - parseNewsTs(a.publishedAtET)).slice(0, 2),"
new_sort = "items: [...items].sort((a, b) => b.publishedAtET.localeCompare(a.publishedAtET)),"
text = text.replace(old_sort, new_sort)

# 3. Add tickerPrefix
old_return = """  }

  return ("""
new_return = """  }

  const tickerPrefix = selectedItem ? `${selectedItem.symbol} ${selectedItem.lastPrice}` : selectedSymbol;

  return ("""
text = text.replace(old_return, new_return)

# 4. Modify Headline to add tickerPrefix and swap sections!
import re

part_narrative = re.search(r'(<div>\s*<div className=\{styles\.dailyDateBoundary\}>.*?</div>\s*</div>)', text, re.DOTALL)
part_timeline = re.search(r'(<div>\s*\{timelineStatus === \'loading\'.*?</div>\s*</div>)', text, re.DOTALL)

narrative_str = part_narrative.group(1)
timeline_str = part_timeline.group(1)

timeline_str = timeline_str.replace("<p className={styles.timelineHeadline}>{item.headline}</p>", "<p className={styles.timelineHeadline}><strong style={{ color: '#ebf4ff', marginRight: '6px' }}>{tickerPrefix}</strong> <span style={{ color: '#89a0bb' }}>-</span> {item.headline}</p>")

new_stack_content = f"{timeline_str}\n\n          {narrative_str}"

text = text.replace(f"{narrative_str}\n\n          {timeline_str}", new_stack_content)

with open("frontend/src/components/watchlist_mvp/CenterPanel.tsx", "w", encoding="utf-8") as f:
    f.write(text)
