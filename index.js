const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

// Socolive ရဲ့ ဖြစ်နိုင်ခြေရှိသော domain list
const SOURCE_DOMAINS = [
    'https://www.bayaerial.com/',
    'https://moralheroes.org/'
    // နောက်ပိုင်း domain အသစ်တွေ့ရင် ဒီနေရာမှာ ထပ်ထည့်နိုင်သည်
];

// --- Helper Functions ---
const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};
const formatLogoUrl = (logoFileName, baseUrl) => {
    if (!logoFileName || !baseUrl) return null;
    return `${baseUrl}wp-content/uploads/truc-tiep/logos/football/team/${logoFileName}`;
};
const formatStreamUrl = (postName, blvId, baseUrl) => {
    if (!postName || !baseUrl) return null;
    return `${baseUrl}truc-tiep/${postName}/?blv=${blvId}`;
}
const formatStatus = (statusId) => {
    const statusStr = String(statusId);
    switch (statusStr) {
        case '0': return 'Upcoming';
        case '1': // First half
        case '2': // Half time
        case '3': // Second half
        case '4': // Second half (ဒါက သင့်ဆီမှာ ဖြစ်နေတာ)
        case '5': // Over time
        case '6': // Over time break
        case '7': // Penalty shootout
            return 'Live'; // ဒီ case တွေ အားလုံးကို "Live" လို့ ပြန်ပေးမယ်
        case '8': return 'Finished';
        case '9': return 'Cancelled';
        case '10': return 'Postponed'; // ဥပမာ ထပ်ထည့်နိုင်
        default: return `Unknown (${statusStr})`; // မသိရင် ID ပါ ပြပေးမယ်
    }
};

const fetchFromSources = async () => {
    for (const domain of SOURCE_DOMAINS) {
        try {
            console.log(`Trying to fetch from: ${domain}`);
            const response = await axios.get(domain, { timeout: 5000 });
            console.log(`Successfully fetched from: ${domain}`);
            return { html: response.data, baseUrl: domain };
        } catch (error) {
            console.warn(`Failed to fetch from ${domain}: ${error.message}`);
        }
    }
    throw new Error('All source domains failed.');
};

// --- API Endpoints Logic ---
const handleMatchesRequest = async (req, res, filterHotOnly = false) => {
    try {
        const { html, baseUrl } = await fetchFromSources();
        const $ = cheerio.load(html);
        const matchesDataScript = $('#matches-data').html();

        if (matchesDataScript) {
            const rawMatches = JSON.parse(matchesDataScript);
            
            let cleanedMatches = rawMatches.map(match => {
                // --- Server Name ပြောင်းလဲထားသော အပိုင်း ---
                // .map function ရဲ့ ဒုတိယ parameter (index) ကိုသုံးပြီး Server နံပါတ်တပ်ပါမည်။
                const streams = match.match_data.anchors.map((anchor, index) => ({
                    server_name: `Server ${index + 1}`, // "commentator" အစား "server_name" ကိုသုံးပြီး "Server 1", "Server 2" ... ဟုပြောင်းလိုက်သည်။
                    stream_page_url: formatStreamUrl(match.post_name, anchor.uid, baseUrl)
                }));

                return {
                    match_id: match.id,
                    status: formatStatus(match.status_id),
                    is_hot: match.hot === '1',
                    competition: match.match_data.competition_full,
                    kickoff_time: formatTimestamp(match.time),
                    home_team: { name: match.home_name, logo_url: formatLogoUrl(match.home_logo, baseUrl) },
                    away_team: { name: match.away_name, logo_url: formatLogoUrl(match.away_logo, baseUrl) },
                    streams: streams
                };
            });
            
            // --- Filtering ---
            if (filterHotOnly) {
                cleanedMatches = cleanedMatches.filter(match => match.is_hot === true);
            } else {
                const { status, hot, league } = req.query;
                if (status) cleanedMatches = cleanedMatches.filter(match => match.status.toLowerCase() === status.toLowerCase());
                if (hot) cleanedMatches = cleanedMatches.filter(match => match.is_hot.toString() === hot);
                if (league) cleanedMatches = cleanedMatches.filter(match => match.competition.toLowerCase().includes(league.toLowerCase()));
            }

            // --- Pagination ---
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const totalItems = cleanedMatches.length;

            const results = {
                totalItems,
                totalPages: Math.ceil(totalItems / limit),
                currentPage: page,
                itemsPerPage: limit,
                sourceDomain: baseUrl,
                data: cleanedMatches.slice(startIndex, endIndex),
            };
            
            res.json(results);
        } else {
            res.status(404).json({ error: 'Matches data script not found on the page.' });
        }

    } catch (error) {
        console.error('Error processing request:', error.message);
        res.status(500).json({ error: 'Failed to fetch or process data from all sources.', details: error.message });
    }
};

app.get('/api/matches', (req, res) => handleMatchesRequest(req, res, false));
app.get('/api/matches/hot', (req, res) => handleMatchesRequest(req, res, true));

app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
});

