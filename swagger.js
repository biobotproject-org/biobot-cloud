const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'BioBot Cloud API',
            version: '1.0.0',
            description: 'REST API for the BioBot wildfire detection IoT platform',
        },
        servers: [
            { url: 'https://your-api-domain.com', description: 'Production' },
            { url: 'http://localhost:3000', description: 'Local dev' },
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key',
                },
            },
        },
    },
    apis: ['./routes/**/*.js', './index.js'],
};

module.exports = swaggerJsdoc(options);