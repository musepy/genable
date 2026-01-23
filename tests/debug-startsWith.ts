
import { postProcess } from '../src/services/postProcessor';
import { NODE_TYPES, PROPS } from '../src/constants/figma-api';
import { NodeLayer } from '../src/schema/layerSchema';

async function testDebug() {
    console.log('🧪 Testing "i.startsWith" robustness fix...');

    const malformedNode: NodeLayer = {
        type: NODE_TYPES.FRAME,
        props: {
            [PROPS.name]: 'Test Node',
            [PROPS.semantic]: 'BUTTON',
            // [CRITICAL] Malformed effect with object color instead of string
            [PROPS.effects]: [
                {
                    type: 'DROP_SHADOW',
                    color: { r: 0, g: 0, b: 0, a: 0.1 } as any, // This would have caused startsWith to fail
                    offset: { x: 0, y: 4 },
                    blur: 10
                }
            ]
        },
        children: []
    };

    try {
        const result = await postProcess(malformedNode);
        console.log('✅ postProcess completed successfully with malformed data!');
    } catch (e) {
        console.error('❌ postProcess FAILED:', e);
        process.exit(1);
    }
}

testDebug();
