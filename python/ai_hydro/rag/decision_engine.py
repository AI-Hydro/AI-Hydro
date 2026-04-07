"""
Decision Engine for AI-Hydro RAG System
========================================

Provides lightweight, intelligent filtering to help AI choose between:
- Tools (hardcoded executable functions) vs Workflows (flexible blueprints)
- Tier 1/2/3 tools based on query complexity
- Standard vs custom analysis approaches

This is a HYBRID approach that:
1. Does lightweight pre-filtering (removes redundancy, simple scoring)
2. Provides metadata to help AI make final decision
3. Maintains flexibility - doesn't over-filter
"""

from typing import Dict, List, Any, Optional
import re


class QueryAnalyzer:
    """
    Analyzes query characteristics to guide tool/workflow selection.
    """
    
    # Keywords indicating user wants standard/complete solution
    STANDARD_KEYWORDS = [
        'complete', 'full', 'all', 'standard', 'default',
        'production', 'ready', 'automated', 'auto'
    ]
    
    # Keywords indicating user wants customization
    CUSTOM_KEYWORDS = [
        'custom', 'specific', 'only', 'exclude', 'filter',
        'modify', 'adjust', 'change', 'flexible', 'particular'
    ]
    
    # Keywords indicating learning/exploration intent
    LEARNING_KEYWORDS = [
        'how', 'why', 'explain', 'understand', 'learn',
        'tutorial', 'guide', 'step', 'process', 'what is'
    ]
    
    @staticmethod
    def analyze(query_text: str) -> Dict[str, Any]:
        """
        Analyze query to determine intent and complexity.
        
        Args:
            query_text: User's query
            
        Returns:
            Dictionary with query analysis:
            - type: "standard", "custom", "learning", or "ambiguous"
            - complexity: "simple" or "complex"
            - confidence: float 0.0-1.0
            - keywords_found: list of matched keywords
        """
        import re
        
        query_lower = query_text.lower()
        
        # Check for keyword matches using word boundaries to avoid partial matches
        def word_in_text(word: str, text: str) -> bool:
            """Check if word exists as whole word in text"""
            pattern = r'\b' + re.escape(word) + r'\b'
            return bool(re.search(pattern, text))
        
        standard_matches = [kw for kw in QueryAnalyzer.STANDARD_KEYWORDS if word_in_text(kw, query_lower)]
        custom_matches = [kw for kw in QueryAnalyzer.CUSTOM_KEYWORDS if word_in_text(kw, query_lower)]
        learning_matches = [kw for kw in QueryAnalyzer.LEARNING_KEYWORDS if word_in_text(kw, query_lower)]
        
        # Determine query type
        if learning_matches:
            query_type = "learning"
            confidence = 0.8
            keywords = learning_matches
        elif custom_matches and not standard_matches:
            query_type = "custom"
            confidence = 0.7
            keywords = custom_matches
        elif standard_matches and not custom_matches:
            query_type = "standard"
            confidence = 0.7
            keywords = standard_matches
        elif custom_matches and standard_matches:
            # Ambiguous - has both
            query_type = "ambiguous"
            confidence = 0.4
            keywords = standard_matches + custom_matches
        else:
            # No clear indicators
            query_type = "ambiguous"
            confidence = 0.3
            keywords = []
        
        # Estimate complexity (simple heuristics)
        word_count = len(query_text.split())
        has_multiple_requests = any(sep in query_lower for sep in ['and', 'then', 'after', 'also'])
        
        if word_count > 20 or has_multiple_requests:
            complexity = "complex"
        else:
            complexity = "simple"
        
        return {
            "type": query_type,
            "complexity": complexity,
            "confidence": confidence,
            "keywords_found": keywords
        }


class DecisionEngine:
    """
    Lightweight decision engine for tool/workflow recommendations.
    
    This engine does NOT make final decisions - it filters and scores results
    to help the AI make better informed decisions.
    """
    
    def __init__(self):
        """Initialize decision engine."""
        self.query_analyzer = QueryAnalyzer()
    
    def filter_and_score(
        self,
        query_text: str,
        tool_results: List[Dict[str, Any]],
        workflow_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Filter and score tool/workflow results to help AI decision-making.
        
        This method:
        1. Removes redundancy (same workflow in both tools and workflows)
        2. Applies relevance boosting based on query analysis
        3. Returns metadata to guide AI's final decision
        
        Args:
            query_text: User's query
            tool_results: Results from tool_registry.search_tools()
            workflow_results: Results from workflow_registry.search_workflows()
            
        Returns:
            Dictionary with filtered/scored results and metadata:
            {
                "tools": [filtered tool results],
                "workflows": [filtered workflow results],
                "metadata": {
                    "query_analysis": {...},
                    "recommendation": "tools" | "workflows" | "both",
                    "reasoning": str
                }
            }
        """
        # Analyze query
        query_analysis = self.query_analyzer.analyze(query_text)
        
        # Remove redundancy between tier3 tools and workflow YAMLs
        deduplicated_workflows = self._deduplicate_workflows(
            tool_results, workflow_results, query_analysis
        )
        
        # Apply relevance boosting
        scored_tools = self._score_tools(tool_results, query_analysis)
        scored_workflows = self._score_workflows(deduplicated_workflows, query_analysis)
        
        # Generate recommendation metadata
        recommendation = self._generate_recommendation(
            scored_tools, scored_workflows, query_analysis
        )
        
        # Wrap results with proper structure for RAG engine
        wrapped_tools = [
            {
                'tool_data': tool,
                'score': tool.get('relevance', 0.5),
                'reason': tool.get('boost_reason', '')
            }
            for tool in scored_tools[:5]
        ]
        
        wrapped_workflows = [
            {
                'workflow_data': wf,
                'score': wf.get('relevance', 0.5),
                'reason': wf.get('boost_reason', '')
            }
            for wf in scored_workflows[:3]
        ]
        
        return {
            "tools": wrapped_tools,
            "workflows": wrapped_workflows,
            "query_intent": query_analysis.get('type', 'ambiguous'),
            "metadata": {
                "query_analysis": query_analysis,
                **recommendation
            }
        }
    
    def _deduplicate_workflows(
        self,
        tool_results: List[Dict[str, Any]],
        workflow_results: List[Dict[str, Any]],
        query_analysis: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Remove redundancy between Tier 3 tools and workflow YAMLs.
        
        If both exist for same workflow:
        - For "standard" queries: Keep tool, mark workflow as "alternative"
        - For "custom" queries: Keep workflow, mark tool as "alternative"
        - For "ambiguous": Keep both but add metadata
        """
        # Get names of tier3 tools
        tier3_tool_names = set(
            t.get('full_path', '').split('.')[-1]
            for t in tool_results
            if t.get('tier') == 'tier3' and t.get('type') == 'tool'
        )
        
        # Get names of workflows
        workflow_names = set(w.get('name', '').lower().replace(' ', '_') for w in workflow_results)
        
        # Find overlaps
        overlaps = tier3_tool_names.intersection(workflow_names)
        
        if not overlaps:
            return workflow_results  # No redundancy
        
        # Handle overlaps based on query type
        filtered_workflows = []
        query_type = query_analysis.get('type', 'ambiguous')
        
        for workflow in workflow_results:
            wf_name = workflow.get('name', '').lower().replace(' ', '_')
            
            if wf_name in overlaps:
                if query_type == "standard":
                    # Prefer tool over workflow - mark workflow as alternative
                    workflow['metadata'] = workflow.get('metadata', {})
                    workflow['metadata']['alternative_to_tool'] = True
                    workflow['metadata']['note'] = "Tool version available - use for standard analysis"
                elif query_type == "custom":
                    # Prefer workflow over tool - keep it
                    workflow['metadata'] = workflow.get('metadata', {})
                    workflow['metadata']['preferred_for_custom'] = True
                # For ambiguous, keep both
            
            filtered_workflows.append(workflow)
        
        return filtered_workflows
    
    def _score_tools(
        self,
        tool_results: List[Dict[str, Any]],
        query_analysis: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Apply relevance boosting to tool results based on query analysis.
        """
        query_type = query_analysis.get('type', 'ambiguous')
        
        scored = []
        for tool in tool_results:
            tool_copy = tool.copy()
            base_score = tool_copy.get('relevance', 0.5)
            
            # Boost scoring based on query type
            if query_type == "standard" and tool.get('tier') == 'tier3':
                # Boost tier3 tools for standard queries
                tool_copy['relevance'] = min(1.0, base_score + 0.1)
                tool_copy['boost_reason'] = "Standard query prefers complete tools"
            elif query_type == "custom" and tool.get('tier') == 'tier2':
                # Boost tier2 tools for custom queries (more flexible)
                tool_copy['relevance'] = min(1.0, base_score + 0.1)
                tool_copy['boost_reason'] = "Custom query prefers flexible tier2 tools"
            else:
                tool_copy['relevance'] = base_score
            
            scored.append(tool_copy)
        
        # Sort by relevance
        return sorted(scored, key=lambda x: x.get('relevance', 0), reverse=True)
    
    def _score_workflows(
        self,
        workflow_results: List[Dict[str, Any]],
        query_analysis: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Apply relevance boosting to workflow results based on query analysis.
        """
        query_type = query_analysis.get('type', 'ambiguous')
        complexity = query_analysis.get('complexity', 'simple')
        
        scored = []
        for workflow in workflow_results:
            wf_copy = workflow.copy()
            base_score = wf_copy.get('relevance', 0.5)
            
            # Boost scoring
            if query_type == "custom":
                # Workflows are guidance-only, perfect for customization
                wf_copy['relevance'] = min(1.0, base_score + 0.15)
                wf_copy['boost_reason'] = "Custom query prefers flexible workflow guidance"
            elif query_type == "learning":
                # Learning queries benefit from step-by-step workflows
                wf_copy['relevance'] = min(1.0, base_score + 0.2)
                wf_copy['boost_reason'] = "Learning query benefits from workflow guidance"
            elif complexity == "complex":
                # Complex queries may need workflow orchestration
                wf_copy['relevance'] = min(1.0, base_score + 0.1)
                wf_copy['boost_reason'] = "Complex query may benefit from workflow"
            else:
                wf_copy['relevance'] = base_score
            
            scored.append(wf_copy)
        
        # Sort by relevance
        return sorted(scored, key=lambda x: x.get('relevance', 0), reverse=True)
    
    def _generate_recommendation(
        self,
        scored_tools: List[Dict[str, Any]],
        scored_workflows: List[Dict[str, Any]],
        query_analysis: Dict[str, Any]
    ) -> Dict[str, str]:
        """
        Generate recommendation metadata to guide AI decision.
        """
        query_type = query_analysis.get('type', 'ambiguous')
        confidence = query_analysis.get('confidence', 0.5)
        
        # Generate recommendation
        if query_type == "standard" and confidence > 0.6:
            recommendation = "tools"
            reasoning = "Query suggests standard analysis - prefer hardcoded tools for efficiency"
        elif query_type == "custom" and confidence > 0.6:
            recommendation = "workflows"
            reasoning = "Query suggests customization - prefer flexible workflow guidance"
        elif query_type == "learning":
            recommendation = "workflows"
            reasoning = "Learning query - workflow blueprints provide better understanding"
        elif scored_tools and scored_workflows:
            recommendation = "both"
            reasoning = "Ambiguous query - AI should evaluate both tools and workflows"
        elif scored_tools:
            recommendation = "tools"
            reasoning = "Only tools found - no workflow match"
        elif scored_workflows:
            recommendation = "workflows"
            reasoning = "Only workflows found - no tool match"
        else:
            recommendation = "none"
            reasoning = "No relevant tools or workflows found"
        
        return {
            "recommendation": recommendation,
            "reasoning": reasoning,
            "confidence": confidence
        }


# Global instance
_decision_engine_instance: Optional[DecisionEngine] = None


def get_decision_engine() -> DecisionEngine:
    """
    Get the global decision engine instance.
    
    Returns:
        Singleton DecisionEngine instance
    """
    global _decision_engine_instance
    
    if _decision_engine_instance is None:
        _decision_engine_instance = DecisionEngine()
    
    return _decision_engine_instance
