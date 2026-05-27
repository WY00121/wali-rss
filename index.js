const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

// VLR.gg RSS - 国际赛事资讯
const VLR_RSS_URL = 'https://www.vlr.gg/rss';

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

app.listen(PORT, () => {
  console.log(`WALI RSS server running on port ${PORT}`);
  console.log(`  - VLR RSS: http://localhost:${PORT}/vlr/rss`);
  console.log(`  - VCT RSS: http://localhost:${PORT}/vct/rss`);
  console.log(`  - Health: http://localhost:${PORT}/health`);
});