const fs = require('fs');
const path = require('path');

function analyzeProject(rootPath) {

    const structure = {
        files: [],
        routes: [],
        services: [],
        models: [],
        controllers: [],
        entryPoints: [],
        dbFiles: [],
        frameworks: new Set(),
        flow: []
    };

    function walk(dir) {
        fs.readdirSync(dir).forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory() &&
                file !== 'node_modules' &&
                file !== '.git' &&
                file !== 'dist'
            ) {
                walk(fullPath);
            } else if (stat.isFile()) {

                structure.files.push(fullPath);
                const lower = file.toLowerCase();

                // Entry detection
                if (
                    lower === 'server.js' ||
                    lower === 'app.js' ||
                    lower === 'main.py' ||
                    lower === 'index.js'
                ) {
                    structure.entryPoints.push(file);
                }

                if (lower.includes('route'))
                    structure.routes.push(file);

                if (lower.includes('service'))
                    structure.services.push(file);

                if (lower.includes('controller'))
                    structure.controllers.push(file);

                if (lower.includes('model'))
                    structure.models.push(file);

                if (lower.includes('db'))
                    structure.dbFiles.push(file);

                const content = fs.readFileSync(fullPath, 'utf-8');

                if (content.includes('express'))
                    structure.frameworks.add('Express');

                if (content.includes('Flask'))
                    structure.frameworks.add('Flask');

                if (content.includes('app.listen'))
                    structure.flow.push(`Server starts in ${file}`);

                if (content.includes('router.get') || content.includes('app.get'))
                    structure.flow.push(`HTTP route defined in ${file}`);
            }
        });
    }

    walk(rootPath);

    const architecture = detectArchitecture(structure);

    const onboardingGuide = generateOnboarding(structure);

    const flowDiagram = generateFlowDiagram(structure);

    return {
        architecture,
        frameworks: [...structure.frameworks],
        structure,
        onboardingGuide,
        flowDiagram
    };
}

function detectArchitecture(s) {

    if (s.routes.length && s.services.length && s.models.length)
        return "Layered MVC Architecture";

    if (s.routes.length && s.services.length)
        return "Layered Express API";

    if (s.dbFiles.length)
        return "Monolithic API with Direct DB Access";

    return "Basic Monolithic Application";
}

function generateOnboarding(s) {

    return {
        startHere: s.entryPoints.length ? s.entryPoints[0] : "No clear entry file detected",
        modifyAPI: s.routes.length ? s.routes[0] : "No route layer found",
        businessLogic: s.services.length ? s.services[0] : "Service layer not separated",
        database: s.dbFiles.length ? s.dbFiles[0] : "Database module not clearly separated"
    };
}

function generateFlowDiagram(s) {

    return `
graph TD
    Client --> Routes
    Routes --> Controllers
    Controllers --> Services
    Services --> Models
    Models --> Database
`;
}

module.exports = { analyzeProject };