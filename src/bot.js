import pkg from 'whatsapp-web.js';
const { Client, RemoteAuth, List } = pkg;
import { MongoStore } from 'wwebjs-mongo';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initDB, loadSessionsFromDB, saveSessionToDB, recordError, getTopError, mongoose } from './db.js';

dotenv.config();

let currentQR = "";
let clientReady = false;

const app = express();
app.get('/', async (req, res) => {
    if (clientReady) {
        return res.send('<h1>WhatsApp Bot is Online! 🚀</h1>');
    }
    if (currentQR) {
        try {
            const qrImage = await QRCode.toDataURL(currentQR);
            return res.send(`
                <div style="display:flex; flex-direction:column; align-items:center; margin-top:50px; font-family:sans-serif;">
                    <h2>Escaneie o QR Code abaixo com seu WhatsApp</h2>
                    <img src="${qrImage}" style="width:350px; height:350px; border:2px solid black; border-radius:10px;" />
                    <p>Depois de escanear, esta página não será mais necessária.</p>
                </div>
            `);
        } catch (err) {
            return res.send('Erro ao renderizar QR Code.');
        }
    }
    res.send('<h3>Aguardando geração do QR Code... Atualize a página em 10 segundos.</h3>');
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Servidor web escutando na porta ${port}`));

let client;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const questions = [
    { id: 1, question: "She ___ to the store yesterday.", options: ["A) go", "B) goes", "C) went", "D) going"], correct: 2, explanation: "'Yesterday' indica passado simples. O verbo 'go' no passado é 'went'." },
    { id: 2, question: "They ___ playing football when it started raining.", options: ["A) were", "B) was", "C) are", "D) is"], correct: 0, explanation: "Pronome 'They' usa 'were' no passado contínuo." },
    { id: 3, question: "If I ___ rich, I would travel the world.", options: ["A) am", "B) was", "C) were", "D) be"], correct: 2, explanation: "No segundo conditional, usamos 'were' para todas as pessoas." },
    { id: 4, question: "The book ___ by millions of people worldwide.", options: ["A) has read", "B) has been read", "C) have read", "D) is reading"], correct: 1, explanation: "Voz passiva no present perfect: 'has/have + been + past participle'." },
    { id: 5, question: "I wish I ___ harder when I was young.", options: ["A) studied", "B) had studied", "C) would study", "D) study"], correct: 1, explanation: "Third conditional para desejos sobre o passado." },
    { id: 6, question: "Had I known about the traffic, I ___ earlier.", options: ["A) would leave", "B) would have left", "C) will leave", "D) left"], correct: 1, explanation: "Inversão condicional. Resposta: 'would have left'." },
    { id: 7, question: "By the time we arrived, the movie ___.", options: ["A) started", "B) had started", "C) has started", "D) was starting"], correct: 1, explanation: "'By the time' indica ação anterior no passado. Usa-se past perfect." },
    { id: 8, question: "Which sentence is CORRECT?", options: ["A) He is interested on learning", "B) He is interested in learning", "C) He is interested about learning", "D) He is interested for learning"], correct: 1, explanation: "O adjetivo 'interested' exige a preposição 'in'." },
    { id: 9, question: "She refused ___ the job because the salary was low.", options: ["A) taking", "B) to take", "C) take", "D) took"], correct: 1, explanation: "'Refuse' é seguido de infinitivo: 'to take'." },
    { id: 10, question: "The more you practice, ___ you become.", options: ["A) the better", "B) better", "C) the best", "D) best"], correct: 0, explanation: "Estrutura 'The + comparativo..., the + comparativo...'." }
];

const levelMessages = {
    "A1": [
        "What's your name?",
        "How are you today?",
        "What do you do for work?",
        "Do you like music?",
        "Where are you from?",
        "What did you do yesterday?",
        "I like eating pizza. Do you like pizza?",
        "She is a teacher. She works at a school."
    ],
    "A2": [
        "What did you do last weekend?",
        "Have you ever been to another country?",
        "I usually drink coffee in the morning. What about you?",
        "What are your hobbies?",
        "Can you tell me about your family?",
        "I went to the supermarket yesterday and bought some fruits.",
        "What would you like to do this weekend?"
    ],
    "B1": [
        "If you could travel anywhere, where would you go?",
        "What do you usually do when you feel stressed?",
        "I think social media has changed the way we communicate.",
        "Have you read any interesting books recently?",
        "What was the most memorable trip you've ever taken?",
        "I believe that learning new languages opens many doors."
    ],
    "B2": [
        "What are the advantages and disadvantages of working remotely?",
        "Do you think technology has made our lives better or worse?",
        "I would have studied harder if I had known about this opportunity.",
        "What's your opinion on climate change?",
        "If I were in your position, I would consider all the options carefully.",
        "Have you ever had to deal with a difficult coworker?"
    ],
    "C1": [
        "To what extent do you think artificial intelligence will affect our daily lives?",
        "Had I been aware of the consequences, I would have made a different decision.",
        "What measures do you believe should be taken to address environmental issues?",
        "I find it fascinating how language evolves over time.",
        "In what ways has your perspective on life changed over the years?"
    ],
    "C2": [
        "The proliferation of misinformation poses a significant threat to democratic societies.",
        "To what extent can we attribute human behavior to innate characteristics versus environmental factors?",
        "I would argue that the dichotomy between nature and nurture is a false one.",
        "What are the implications of globalization on cultural identity?",
        "One could contend that the notion of privacy has become increasingly obsolete in the digital age."
    ]
};

const levelDescriptions = {
    "A1": "Você está no nível iniciante. Continue praticando present simple e vocabulário básico.",
    "A2": "Você tem uma base básica. Pratique passado simples e verbos comuns.",
    "B1": "Você está no nível intermediário. Trabalhe em condicionais e voz passiva.",
    "B2": "Você tem um bom nível! Foque em phrasal verbs e expressões idiomáticas.",
    "C1": "Você está no nível avançado. Pratique construções complexas.",
    "C2": "Você tem domínio avançado do inglês. Continue refinando sua fluência."
};

const userSessions = new Map();

async function getAIResponse(level, historyObjArray, scenario = null) {
    if (!process.env.GEMINI_API_KEY) {
        return "I'm sorry, my AI brain is not configured right now. (Missing GEMINI_API_KEY)";
    }
    
    // Get last 5 messages for context
    const recentHistory = historyObjArray.slice(-5).map(h => `User: ${h.user}\nBot: ${h.bot}`).join("\n\n");
    const lastUserMessage = historyObjArray[historyObjArray.length - 1]?.user || "";

    let scenarioInstruction = "";
    if (scenario) {
        scenarioInstruction = `You are currently in a ROLEPLAY SCENARIO: "${scenario}". Fully adopt the persona, setting, and context of this scenario. Guide the conversation naturally within this context. DO NOT break character.`;
    }

    const prompt = `You are a friendly, cool Native English Teacher named 'Vertex Digital'. You are chatting on WhatsApp with a student (CEFR level: ${level}).
Make your message feel like a real human texting a friend, not a robotic AI.
${scenarioInstruction}
- Be highly conversational, empathetic, and enthusiastic.
- Use emojis naturally but don't overdo it.
- Use conversational fillers like 'Oh wow', 'Haha', 'That makes sense', 'I see'.
- For intermediate/advanced levels (B1+), use natural slang and idioms (e.g. 'gonna', 'wanna', 'hit the books').
- Keep your response short, natural, and entirely in English.
- Vocabulary and grammar MUST be appropriate for level ${level}.
- Ask a creative or personal follow-up question related to the topic to keep the conversation flowing.
- Use *bold* for emphasis or _italics_ sparingly, mimicking WhatsApp behavior.

Recent conversation history:
${recentHistory}

Reply directly to the student's latest message and continue the conversation:
"${lastUserMessage}"`;

    try {
        const result = await aiModel.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error("Gemini AI Error:", error);
        return "I'm having a little trouble thinking right now. Could you tell me more about that?";
    }
}

function getLevel(score) {
    if (score <= 2) return "A1";
    if (score <= 4) return "A2";
    if (score <= 6) return "B1";
    if (score <= 8) return "B2";
    if (score <= 9) return "C1";
    return "C2";
}

function getLevelFullName(level) {
    const names = {
        "A1": "A1 - Iniciante",
        "A2": "A2 - Básico",
        "B1": "B1 - Intermediário",
        "B2": "B2 - Upper-Intermediate",
        "C1": "C1 - Avançado",
        "C2": "C2 - Proficiente"
    };
    return names[level];
}

async function getCorrection(text, level) {
    const prompt = `Você é um professor de inglês experiente analisando uma mensagem de um aluno (Nível: ${level}) no WhatsApp.
Mensagem do aluno: "${text}"

Se a mensagem estiver perfeitamente correta em inglês e fizer sentido no contexto de uma conversa natural, responda APENAS com a palavra: PERFECT.
Se houver algum erro gramatical, erro de digitação, vocabulário estranho, ou falta de contexto, forneça uma explicação amigável e detalhada em PORTUGUÊS sobre o erro e sugira a forma correta.
Exemplo de formato: "A frase '...' parece fora de contexto porque... O ideal seria dizer '...'."

No final da sua resposta, pule uma linha e escreva CATEGORIA: [Nome da categoria do erro em inglês, ex: Prepositions, Verb Tense, Vocabulary, Context, Spelling].`;

    try {
        const result = await aiModel.generateContent(prompt);
        const responseText = result.response.text().trim();
        
        if (responseText === "PERFECT" || responseText.startsWith("PERFECT")) {
            return { hasErrors: false, corrections: [] };
        }

        const lines = responseText.split('\n');
        let tip = responseText;
        let type = "Grammar";

        if (lines.length > 1 && lines[lines.length - 1].includes("CATEGORIA:")) {
            type = lines.pop().replace("CATEGORIA:", "").trim();
            tip = lines.join('\n').trim();
        }

        return {
            hasErrors: true,
            corrections: [{ error: text, message: tip, replacements: [], type }]
        };
    } catch (error) {
        console.error("Erro no Gemini Dicas:", error);
        return { hasErrors: false, corrections: [] };
    }
}

async function translateToPortuguese(text) {
    try {
        const response = await fetch("https://api.mymemory.translated.net/get", {
            method: "GET",
            headers: {},
            body: null
        });
        const params = new URLSearchParams({ q: text, langpair: "en|pt" });
        const result = await fetch(`https://api.mymemory.translated.net/get?${params}`);
        const data = await result.json();
        return data.responseData?.translatedText || "Tradução não disponível.";
    } catch (error) {
        console.error("Erro na tradução:", error);
        return "Erro ao traduzir.";
    }
}

// Removido getRandomQuestion pois agora usamos Gemini AI

const helpText = `🇺🇸 *Comandos disponíveis:*

/start - Fazer teste de nível
/chat - Iniciar conversa livre
/cenario [tema] - Praticar uma situação real
/praticar - Exercícios focados nos seus erros
/corrigir - Ver correção da última mensagem
/traduzir - Ver tradução em português
/nivel - Ver seu nível atual
/ajuda - Ver este menu

💡 *Dicas:*
• Converse comigo em inglês e eu vou te corrigir!
• Use /corrigir para ver os erros da sua última mensagem
• Use /traduzir para ver a tradução` ;

async function startBot() {
    await initDB();
    await loadSessionsFromDB(userSessions);

    const store = new MongoStore({ mongoose });
    client = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'whatsapp-bot',
            store: store,
            backupSyncIntervalMs: 300000
        }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        },
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                '--no-zygote',
                '--enable-low-end-device-mode',
                '--disable-site-isolation-trials',
                '--disable-remote-fonts',
                '--disable-extensions',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            ]
        }
    });

    client.on("qr", async (qr) => {
        currentQR = qr;
        console.log("⚠️ QR Code gerado! Abra o LINK DO SEU SITE NA RENDER (ali no canto superior esquerdo) no navegador para escanear de forma nítida!");
    });

    client.on("ready", () => {
        currentQR = "";
        clientReady = true;
        console.log("Bot pronto! Conectado ao WhatsApp na nuvem.");
    });

    client.on("remote_session_saved", () => {
        console.log("Sessão do WhatsApp salva no MongoDB Atlas com sucesso!");
    });

    client.on("message", async (message) => {
    const contact = message.from;
    const text = message.body.trim();

    if (!userSessions.has(contact)) {
        userSessions.set(contact, {
            state: "START",
            level: null,
            score: 0,
            currentQuestion: 0,
            conversationHistory: [],
            lastEnglishMessage: null,
            lastPortugueseMessage: null,
            scenario: null
        });
    }

    const session = userSessions.get(contact);

    const command = text.toLowerCase().split(" ")[0];
    const args = text.substring(command.length).trim();

    if (command === "/start") {
        session.state = "TEST";
        session.score = 0;
        session.currentQuestion = 0;
        session.level = null;
        session.conversationHistory = [];
        session.scenario = null;

        const textMsg = `🇺🇸 *English Level Test*\n\nBem-vindo ao teste de nivelamento!\n\n${questions[0].question}\n\n${questions[0].options.join("\n")}\n\n👉 *Digite a letra (A, B, C ou D) correspondente à sua resposta.*`;

        await client.sendMessage(message.from, textMsg);
    }
    else if (session.state === "TEST") {
        const currentQ = questions[session.currentQuestion];
        const answerMap = { "a": 0, "b": 1, "c": 2, "d": 3 };
        const userAnswer = answerMap[text.toLowerCase()];

        if (userAnswer === undefined) {
            await message.reply("❌ Responda apenas com A, B, C ou D.");
            return;
        }

        if (userAnswer === currentQ.correct) session.score++;

        await message.reply(
            userAnswer === currentQ.correct 
                ? `✅ *Correto!* 🎉\n\n${currentQ.explanation}`
                : `❌ *Incorreto.*\n\nResposta: ${currentQ.options[currentQ.correct]}\n\n${currentQ.explanation}`
        );

        session.currentQuestion++;

        if (session.currentQuestion < questions.length) {
            const nextQ = questions[session.currentQuestion];
            const nextTextMsg = `🇺🇸 *English Level Test* (Pergunta ${session.currentQuestion + 1} de 10):\n\n${nextQ.question}\n\n${nextQ.options.join("\n")}\n\n👉 *Digite a sua resposta (A, B, C ou D).*`;
            await client.sendMessage(message.from, nextTextMsg);
        } else {
            session.level = getLevel(session.score);
            const levelInfo = levelDescriptions[session.level];
            
            await message.reply(
                "📊 *TESTE CONCLUÍDO!*\n\n" +
                `✅ Acertos: ${session.score}/10\n\n` +
                `🏆 Nível: *${getLevelFullName(session.level)}*\n\n` +
                `${levelInfo}\n\n` +
                "💬 Digite */chat* para começar a conversar!"
            );
            session.state = "DONE";
        }
    }
    else if (command === "/chat") {
        if (!session.level) {
            await message.reply("❌ Você precisa fazer o teste de nível primeiro! Digite /start");
            return;
        }

        session.state = "CHAT";
        session.conversationHistory = [];
        session.scenario = null;
        
        const firstMessage = await getAIResponse(session.level, [{user: "Hello! Let's chat in English.", bot: ""}]);

        await message.reply(
            `💬 *Modo Conversa - Nível ${session.level}*\n\n` +
            `Vamos conversar em inglês!\n\n${firstMessage}\n\n` +
            "_Escreva em inglês e eu vou te corrigir e responder!_"
        );
    }
    else if (command === "/cenario") {
        if (!session.level) {
            await message.reply("❌ Você precisa fazer o teste de nível primeiro! Digite /start");
            return;
        }

        if (!args) {
            await message.reply("❌ Digite um cenário válido. Exemplo: /cenario entrevista de emprego, /cenario restaurante, /cenario aeroporto");
            return;
        }

        session.state = "CHAT";
        session.scenario = args;
        session.conversationHistory = [];

        await message.reply(`🎭 *Cenário Ativo: ${args.toUpperCase()}*\n\nEntrando no personagem... ⏳`);

        const firstMessage = await getAIResponse(session.level, [{user: `Vamos iniciar o cenário: ${args}. Mande a sua primeira fala!`, bot: ""}], session.scenario);
        
        session.conversationHistory.push({
            user: `[START SCENARIO: ${args}]`,
            bot: firstMessage
        });

        await message.reply(firstMessage);
    }
    else if (session.state === "CHAT" && session.level) {
        session.lastEnglishMessage = text;
        session.lastPortugueseMessage = null;

        const correction = await getCorrection(text, session.level);
        
        let correctionText = "";
        if (correction.hasErrors) {
            const c = correction.corrections[0];
            correctionText = `\n\n✅ *Dicas:*\n${c.message}`;
            if (c.type) await recordError(contact, c.type);
        }

        const tempHistory = [...session.conversationHistory, { user: text, bot: "" }];
        const responseString = await getAIResponse(session.level, tempHistory, session.scenario);

        const replyContent = `${responseString}${correctionText}`;

        await message.reply(`${replyContent}\n\n_👉 Responda com /traduzir para traduzir esta mensagem_`);

        session.conversationHistory.push({
            user: text,
            bot: responseString,
            correction: correction
        });
    }
    else if (command === "/corrigir") {
        if (!session.lastEnglishMessage) {
            await message.reply("❌ Nenhuma mensagem para corrigir. Escreva algo primeiro!");
            return;
        }

        const correction = await getCorrection(session.lastEnglishMessage, session.level);

        if (!correction.hasErrors) {
            await message.reply("✅ Sua mensagem estava correta! Não encontrei erros nela.");
            return;
        }

        let response = "📝 *Correção da sua mensagem:*\n\n";
        response += `*Original:* ${session.lastEnglishMessage}\n\n`;

        const c = correction.corrections[0];
        response += `✅ *Dicas:*\n${c.message}`;

        await message.reply(response);
    }
    else if (command === "/traduzir" || text === "🔄 Traduzir") {
        const lastConv = session.conversationHistory[session.conversationHistory.length - 1];
        if (!lastConv || !lastConv.bot) {
            await message.reply("❌ Nenhuma mensagem do bot para traduzir ainda.");
            return;
        }

        if (session.lastBotTranslation && session.lastTranslatedBotMsg === lastConv.bot) {
            await message.reply(`🇧🇷 *Tradução do Bot:*\n\n${session.lastBotTranslation}`);
            return;
        }

        await message.reply("🔄 Traduzindo a mensagem do bot...");
        const translation = await translateToPortuguese(lastConv.bot);
        session.lastTranslatedBotMsg = lastConv.bot;
        session.lastBotTranslation = translation;
        
        await message.reply(`🇧🇷 *Tradução do Bot:*\n\n${translation}`);
    }
    else if (command === "/praticar") {
        if (!session.level) {
            await message.reply("❌ Você precisa fazer o teste de nível primeiro! Digite /start");
            return;
        }

        const topError = await getTopError(contact);
        
        if (!topError) {
            await message.reply("🎉 Você ainda não cometeu erros suficientes para gerar exercícios. Continue conversando usando o /chat!");
            return;
        }

        await message.reply(`🏋️‍♂️ *Hora de Praticar!*\n\nNotei que você comete alguns erros na categoria: *${topError}*.\n\nEstou gerando 3 exercícios rápidos para você treinar... ⏳`);

        const prompt = `You are an English Teacher named 'Vertex Digital'. The student (Level: ${session.level}) often makes errors in the grammar category: "${topError}".
Please generate 3 very short fill-in-the-blank or multiple-choice questions specifically targeting this topic. 
Format nicely with emojis. Provide the answers at the very end in a spoiler or just at the bottom.
Keep the entire response in English and short enough for a WhatsApp message.`;
        
        try {
            const result = await aiModel.generateContent(prompt);
            await message.reply(result.response.text());
        } catch (error) {
            await message.reply("❌ Ocorreu um erro ao gerar os exercícios. Tente novamente mais tarde.");
        }
    }
    else if (command === "/nivel") {
        if (!session.level) {
            await message.reply("❌ Você ainda não fez o teste de nível. Digite /start");
            return;
        }
        await message.reply(
            `🏆 *Seu nível:* ${getLevelFullName(session.level)}\n\n` +
            `${levelDescriptions[session.level]}\n\n` +
            "_Digite /chat para conversar!_"
        );
    }
    else if (command === "/ajuda") {
        await message.reply(helpText);
    }
    else if (session.state === "START" || session.state === "DONE") {
        await message.reply(
            "👋 Olá! Sou o Vertex Digital, seu assistente de inglês!\n\n" +
            "Digite */start* para fazer o teste de nível\n" +
            "ou */ajuda* para ver todos os comandos"
        );
    }
    
    await saveSessionToDB(contact, session);
});

    client.initialize();
}

startBot();
