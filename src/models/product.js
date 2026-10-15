import mongoose from "mongoose";


const resourceSchema =
    new mongoose.Schema(
        {
            codigo: {
                type: String,
                required: true,
                unique: true,
                trim: true
            },

            nombre: {
                type: String,
                required: true,
                trim: true
            },

            precio: {
                type: Number,
                required: true,
                min: 0
            },

            stock: {
                type: Number,
                required: true,
                min: 0,
                default: 0
            }
        },
        {
            timestamps: false,
            versionKey: false
        }
    );


const Resource = mongoose.model("Resource", resourceSchema);

export default Resource;