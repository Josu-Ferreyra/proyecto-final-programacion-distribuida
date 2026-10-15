import mongoose from "mongoose";

const raftLogEntrySchema =
    new mongoose.Schema(
        {
            index: {
                type: Number,
                required: true
            },

            term: {
                type: Number,
                required: true
            },

            command: {
                type: mongoose.Schema.Types.Mixed,
                required: true
            }
        },
        {
            _id: false
        }
    );


const raftPersistentStateSchema =
    new mongoose.Schema(
        {
            nodeId: {
                type: String,
                required: true,
                unique: true,
                trim: true
            },

            currentTerm: {
                type: Number,
                required: true,
                default: 0,
                min: 0
            },

            votedFor: {
                type: String,
                default: null
            },

            log: {
                type: [raftLogEntrySchema],
                default: []
            },

            commitIndex: {
                type: Number,
                default: -1
            },

            lastApplied: {
                type: Number,
                default: -1
            }
        },
        {
            timestamps: true,
            versionKey: false,
            collection: "raftstates"
        }
    );

const RaftPersistentState = mongoose.model("RaftPersistentState", raftPersistentStateSchema);
export default RaftPersistentState;