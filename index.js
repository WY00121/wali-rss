const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// VLR.gg RSS - 国际赛事资讯
const VLR_RSS_URL = 'https://www.vlr.gg/rss';

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// VCT CN API 端点 (待测试)
const VCT_API_URL = 'https://vct.qq.com/news_list.html?gameId=1000065';

// 解析 RSS XML 为 JSON
function parseRSS(xml) {
  return new Promise((resolve, reject) => {
    const parser = new xml2js.Parser({ explicitArray: false });
    parser.parseString(xml, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// 从 RSS 解析赛程数据
function parseScheduleFromRSS(items) {
  const schedule = []
  const now = new Date()

  items.forEach((item, index) => {
    const title = item.title || ''
    const description = item.description || ''

    // 从标题和描述中提取队伍信息
    // 格式: "Team A vs Team B" 或 "Team A takes down Team B"
    const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|takes down|defeats|prevails over)\s+(.+?)(?:\s+to|\s+in|\s+-$|$)/i)
    const scoreMatch = description.match(/(\d+)-\d+\s+(?:in|to)/) || title.match(/\d+-\d+/)

    if (vsMatch || title.toLowerCase().includes('match') || title.toLowerCase().includes('stage') || title.toLowerCase().includes('final')) {
      const match = {
        id: `match-${index}`,
        title: title,
        link: item.link,
        pubDate: item.pubDate,
        description: description,
        // 尝试从标题提取队伍
        teams: vsMatch ? [
          { name: vsMatch[1].trim(), shortName: vsMatch[1].trim().substring(0, 3).toUpperCase() },
          { name: vsMatch[2].trim(), shortName: vsMatch[2].trim().substring(0, 3).toUpperCase() }
        ] : null,
        // 提取比分
        score: scoreMatch ? [parseInt(scoreMatch[1]), 0] : null,
        // 从描述提取赛制
        format: description.includes('BO5') ? 'BO5' : description.includes('BO3') ? 'BO3' : 'BO3',
        // 分类
        category: title.toLowerCase().includes('final') ? 'final' :
                  title.toLowerCase().includes('semi') ? 'semifinal' :
                  title.toLowerCase().includes('quarter') ? 'quarterfinal' :
                  title.toLowerCase().includes('group') ? 'group' : 'match'
      }
      schedule.push(match)
    }
  })

  return schedule
}

// 从 RSS 解析活动数据
function parseEventsFromRSS(items) {
  const events = []
  const now = new Date()

  items.forEach((item, index) => {
    const title = item.title || ''
    const description = item.description || ''

    // 国际赛事通常包含赛程和活动信息
    // 提取包含日期和地点的活动
    const dateMatch = description.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d+/i) ||
                      item.pubDate

    // 提取票务信息
    const ticketMatch = description.match(/(?:ticket|price|cost|buy|¥|\$|USD|EUR)\s*:?\s*([^\s.,]+)/i)
    const hasTicket = ticketMatch || description.toLowerCase().includes('ticket') ||
                      title.toLowerCase().includes('ticket') || description.toLowerCase().includes('buy')

    if (dateMatch || title.toLowerCase().includes('event') || title.toLowerCase().includes('tournament') ||
        title.toLowerCase().includes('masters') || title.toLowerCase().includes('championship') ||
        title.toLowerCase().includes('stage') || title.toLowerCase().includes('league')) {
      events.push({
        id: `event-${index}`,
        title: title,
        link: item.link,
        pubDate: item.pubDate,
        description: description,
        // 从描述提取赛事名称
        eventName: extractEventName(title),
        location: extractLocation(description),
        date: dateMatch ? parseDate(dateMatch) : null,
        category: title.toLowerCase().includes('masters') ? 'masters' :
                  title.toLowerCase().includes('champions') ? 'champions' :
                  title.toLowerCase().includes('americas') ? 'americas' :
                  title.toLowerCase().includes('emea') ? 'emea' :
                  title.toLowerCase().includes('pacific') ? 'pacific' : 'general',
        // 票务信息
        hasTicket: hasTicket,
        ticketPrice: extractTicketPrice(description),
        ticketUrl: description.match(/https?:\/\/[^\s]+(?:ticket|purchase|buy)[^\s]*/i)?.[0] || null,
      })
    }
  })

  return events
}

function extractEventName(title) {
  const match = title.match(/(?:Masters|Championship|Stage|Format|VCT)\s+(?:London|São Paulo|Seoul|Tokyo|Berlin|Paris)/i)
  return match ? match[0] : 'VCT 国际赛事'
}

function extractLocation(description) {
  const locations = ['London', 'São Paulo', 'Seoul', 'Tokyo', 'Berlin', 'Paris', 'Singapore', 'Bangkok']
  for (const loc of locations) {
    if (description.includes(loc) || description.includes(loc)) {
      return loc
    }
  }
  return 'International'
}

function extractTicketPrice(description) {
  // 提取价格
  const usdMatch = description.match(/\$[\d,]+(?:\.\d{2})?/)
  const cnyMatch = description.match(/¥[\d,]+(?:\.\d{2})?/)
  const eurMatch = description.match(/(?:€|EUR)\s*[\d,]+(?:\.\d{2})?/)

  if (usdMatch) return { amount: usdMatch[0], currency: 'USD' }
  if (cnyMatch) return { amount: cnyMatch[0], currency: 'CNY' }
  if (eurMatch) return { amount: eurMatch[0], currency: 'EUR' }
  return null
}

function parseDate(dateStr) {
  try {
    return new Date(dateStr).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

// 生成 RSS 2.0 XML
function generateRSS(items, title, link, description) {
  const itemsXml = items.map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <guid isPermaLink="true">${item.link}</guid>
      <pubDate>${item.pubDate}</pubDate>
      <description><![CDATA[${item.description || ''}]]></description>
    </item>
  `).join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${title}</title>
    <link>${link}</link>
    <description>${description}</description>
    <atom:link href="${link}/rss" rel="self" type="application/rss+xml"/>
    ${itemsXml}
  </channel>
</rss>`;
}

// /vlr/rss - VLR.gg 国际赛事 RSS
app.get('/vlr/rss', async (req, res) => {
  try {
    console.log('[VLR RSS] Fetching:', VLR_RSS_URL);
    const response = await axios.get(VLR_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      timeout: 15000,
    });

    const parsed = await parseRSS(response.data);
    const channel = parsed.rss?.channel;
    if (!channel) {
      throw new Error('Invalid RSS format: no channel');
    }
    let items = channel.item;
    if (!Array.isArray(items)) {
      items = [items];
    }
    const mappedItems = items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      description: item.description,
    }));

    const rss = generateRSS(
      mappedItems,
      'VLR.gg - Valorant Esports News',
      'https://vlr.gg',
      'VLR.gg 国际赛事资讯'
    );

    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(rss);
  } catch (error) {
    console.error('[VLR RSS] Error:', error.message);
    res.status(500).send('Error fetching VLR RSS');
  }
});

// /vct/rss - VCT CN 资讯 (从页面抓取)
app.get('/vct/rss', async (req, res) => {
  try {
    console.log('[VCT RSS] Fetching:', VCT_API_URL);
    const response = await axios.get(VCT_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 15000,
    });

    // 尝试从 window.__INITIAL_STATE__ 提取数据
    const html = response.data;
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);

    if (stateMatch && stateMatch[1]) {
      try {
        const state = JSON.parse(stateMatch[1]);
        console.log('[VCT RSS] Found __INITIAL_STATE__');
        // 从状态中提取新闻列表
        // 根据实际结构调整路径
        const newsList = state?.app?.newsList || state?.data?.newsList || [];

        const items = newsList.map(news => ({
          title: news.title || news.sTitle || '',
          link: news.url || news.sUrl || `https://vct.qq.com/${news.iNewsId}`,
          pubDate: news.pubTime || news.dPubTime || new Date().toISOString(),
          description: news.desc || news.sDesc || news.summary || '',
        })).filter(item => item.title);

        const rss = generateRSS(
          items,
          'VCT CN - 无畏契约赛事资讯',
          'https://vct.qq.com',
          'VCT CN 中国赛区资讯'
        );

        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.send(rss);
        return;
      } catch (parseError) {
        console.error('[VCT RSS] State parse error:', parseError.message);
      }
    }

    // 备用: 直接返回 VLR RSS
    console.log('[VCT RSS] No __INITIAL_STATE__ found, using VLR fallback');
    const vlrResponse = await axios.get(VLR_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/rss+xml',
      },
      timeout: 15000,
    });

    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(vlrResponse.data);
  } catch (error) {
    console.error('[VCT RSS] Error:', error.message);
    res.status(500).send('Error fetching VCT RSS: ' + error.message);
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// /schedule - 赛程数据 JSON
app.get('/schedule', async (req, res) => {
  try {
    console.log('[Schedule] Fetching VLR RSS');
    const response = await axios.get(VLR_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      timeout: 15000,
    });

    const parsed = await parseRSS(response.data);
    const channel = parsed.rss?.channel;
    if (!channel) {
      throw new Error('Invalid RSS format: no channel');
    }
    let items = channel.item;
    if (!Array.isArray(items)) {
      items = [items];
    }

    const schedule = parseScheduleFromRSS(items);

    res.json({
      success: true,
      count: schedule.length,
      data: schedule
    });
  } catch (error) {
    console.error('[Schedule] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// /events - 活动数据 JSON
app.get('/events', async (req, res) => {
  try {
    console.log('[Events] Fetching VLR RSS');
    const response = await axios.get(VLR_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      timeout: 15000,
    });

    const parsed = await parseRSS(response.data);
    const channel = parsed.rss?.channel;
    if (!channel) {
      throw new Error('Invalid RSS format: no channel');
    }
    let items = channel.item;
    if (!Array.isArray(items)) {
      items = [items];
    }

    const events = parseEventsFromRSS(items);

    res.json({
      success: true,
      count: events.length,
      data: events
    });
  } catch (error) {
    console.error('[Events] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// /tickets - 票务信息 (从 Supabase + RSS)
app.get('/tickets', async (req, res) => {
  try {
    console.log('[Tickets] Fetching tickets data');

    // 如果有 Supabase 配置，尝试从 Supabase 获取票务信息
    let supabaseTickets = [];
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .order('sale_time', { ascending: true });

        if (!error && data && data.length > 0) {
          supabaseTickets = data;
        }
      } catch (e) {
        console.log('[Tickets] Supabase fetch skipped:', e.message);
      }
    }

    // 如果 Supabase 没有票务信息，从 RSS 提取赛事票务
    if (supabaseTickets.length === 0) {
      console.log('[Tickets] Fetching from VLR RSS for ticket info');
      const response = await axios.get(VLR_RSS_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
        timeout: 15000,
      });

      const parsed = await parseRSS(response.data);
      const channel = parsed.rss?.channel;
      if (!channel) {
        throw new Error('Invalid RSS format: no channel');
      }
      let items = channel.item;
      if (!Array.isArray(items)) {
        items = [items];
      }

      // 过滤包含票务信息或重要赛事的条目
      const ticketItems = items.filter(item => {
        const desc = (item.description || '').toLowerCase()
        const title = (item.title || '').toLowerCase()
        // 重要赛事（决赛、大师赛、冠军赛等）视为潜在票务
        const isMajorEvent = title.includes('final') || title.includes('masters') ||
                            title.includes('championship') || title.includes('grand')
        // 有价格信息
        const hasPrice = desc.includes('$') || desc.includes('¥') || desc.includes('eur')
        // 有购票相关词汇
        const hasTicket = desc.includes('ticket') || desc.includes('buy') ||
                         desc.includes('purchase') || desc.includes('register')

        return isMajorEvent || hasPrice || hasTicket
      }).map((item, index) => {
        const priceMatch = (item.description || '').match(/(\$[\d,]+(?:\.\d{2})?|¥[\d,]+(?:\.\d{2})?|€[\d,]+(?:\.\d{2})?)/)
        return {
          id: `ticket-${index}`,
          event_name: item.title,
          venue: extractLocation(item.description || ''),
          sale_time: item.pubDate,
          price_range: priceMatch ? priceMatch[0] : '待定',
          ticket_url: item.link,
          source: 'vlr',
        }
      });

      res.json({
        success: true,
        count: ticketItems.length,
        data: ticketItems
      });
    } else {
      res.json({
        success: true,
        count: supabaseTickets.length,
        data: supabaseTickets.map(t => ({
          id: t.id,
          event_name: t.event_name,
          venue: t.venue,
          sale_time: t.sale_time,
          price_range: t.price_range,
          ticket_url: t.ticket_url,
          source: 'supabase',
        }))
      });
    }
  } catch (error) {
    console.error('[Tickets] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`WALI RSS server running on port ${PORT}`);
  console.log(`  - VLR RSS: http://localhost:${PORT}/vlr/rss`);
  console.log(`  - VCT RSS: http://localhost:${PORT}/vct/rss`);
  console.log(`  - Schedule: http://localhost:${PORT}/schedule`);
  console.log(`  - Events: http://localhost:${PORT}/events`);
  console.log(`  - Tickets: http://localhost:${PORT}/tickets`);
  console.log(`  - Health: http://localhost:${PORT}/health`);
});