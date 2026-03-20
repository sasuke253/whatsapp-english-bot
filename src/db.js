import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
    contact: { type: String, required: true, unique: true },
    data: { type: String, required: true }
});

const errorSchema = new mongoose.Schema({
    contact: { type: String, required: true },
    category: { type: String, required: true },
    count: { type: Number, default: 1 }
});

errorSchema.index({ contact: 1, category: 1 }, { unique: true });

export const SessionModel = mongoose.model('Session', sessionSchema);
export const ErrorModel = mongoose.model('Error', errorSchema);
export { mongoose };

export async function initDB() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is not set in .env');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Conectado ao MongoDB!");
}

export async function loadSessionsFromDB(userSessionsMap) {
    const sessions = await SessionModel.find({});
    for (const session of sessions) {
        try {
            userSessionsMap.set(session.contact, JSON.parse(session.data));
        } catch (e) {
            console.error('Error parsing session data for', session.contact);
        }
    }
    console.log("Sessões de usuários carregadas do MongoDB.");
}

export async function saveSessionToDB(contact, sessionObj) {
    const dataString = JSON.stringify(sessionObj);
    await SessionModel.findOneAndUpdate(
        { contact },
        { data: dataString },
        { upsert: true, new: true }
    );
}

export async function recordError(contact, category) {
    await ErrorModel.findOneAndUpdate(
        { contact, category },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
    );
}

export async function getTopError(contact) {
    const top = await ErrorModel.findOne({ contact }).sort({ count: -1 });
    return top ? top.category : null;
}
