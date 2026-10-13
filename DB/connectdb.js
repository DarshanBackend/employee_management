import mongoose from "mongoose";

mongoose.connection.on('connected', () => console.log('connected'));
mongoose.connection.on('disconnected', () => console.log('disconnected'));
mongoose.connection.on('reconnected', () => console.log('reconnected'));
mongoose.connection.on('disconnecting', () => console.log('disconnecting'));
mongoose.connection.on('close', () => console.log('close'));

export async function connectDB(DB_URL) {
    try {
        const connect = await mongoose.connect(DB_URL);
        console.log(`Database connected Successfully AND HOST is ${connect.connection.host}`)
    } catch (error) {
        console.error("Error While Connecting Database!");
        process.exit(1)
    }
}
